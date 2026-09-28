import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export type CaqhAuditAction = "Create" | "Read" | "Update" | "Delete";
export type CaqhAuditOutcome = "Success" | "Minor Failure" | "Serious Failure";
export type CaqhAuditDirection = "inbound" | "outbound";
export type CaqhAuditAgentType = "user" | "client" | "system";
export type CaqhAuditEntityType = "Practitioner" | "Organization";
export type CaqhHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type FhirAuditActionCode = "C" | "R" | "U" | "D";
export type FhirAuditOutcomeCode = "0" | "4" | "8";

export interface FhirAuditEvent {
  resourceType: "AuditEvent";
  id: string;
  type: {
    system: string;
    code: string;
    display?: string;
  };
  subtype?: Array<{
    system: string;
    code: string;
    display?: string;
  }>;
  action?: FhirAuditActionCode;
  recorded: string;
  outcome?: FhirAuditOutcomeCode;
  outcomeDesc?: string;
  agent: Array<{
    who?: {
      identifier?: {
        system?: string;
        value?: string;
      };
    };
    altId?: string;
    requestor: boolean;
  }>;
  source: {
    observer: {
      identifier?: {
        system?: string;
        value?: string;
      };
      display?: string;
    };
  };
  entity?: Array<{
    what?: {
      identifier?: {
        system?: string;
        value?: string;
      };
      display?: string;
    };
    description?: string;
  }>;
}

export interface CaqhAuditInput {
  tenantId: string;
  correlationId?: string;
  direction: CaqhAuditDirection;
  method: CaqhHttpMethod;
  endpoint: string | URL;
  action?: CaqhAuditAction;
  agent: {
    type: CaqhAuditAgentType;
    id: string;
  };
  entity: {
    type: CaqhAuditEntityType;
    id: string;
  };
  outcome?: CaqhAuditOutcome;
  httpStatus?: number;
  outcomeDescription?: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  durationMs?: number;
}

export interface AuditedCaqhFetchInput {
  tenantId: string;
  url: string | URL;
  init?: RequestInit;
  action?: CaqhAuditAction;
  agent: CaqhAuditInput["agent"];
  entity: CaqhAuditInput["entity"];
  requestPayloadForHash?: unknown;
}

export type CaqhAuditDatabase = NodePgDatabase<any>;

export type CaqhAuditWriter = (
  database: CaqhAuditDatabase,
  input: CaqhAuditInput,
) => Promise<FhirAuditEvent>;

export interface AuditedCaqhFetchDependencies {
  fetchImpl?: typeof fetch;
  auditWriter?: CaqhAuditWriter;
}

const ACTION_CODES: Record<CaqhAuditAction, FhirAuditActionCode> = {
  Create: "C",
  Read: "R",
  Update: "U",
  Delete: "D",
};

const OUTCOME_CODES: Record<CaqhAuditOutcome, FhirAuditOutcomeCode> = {
  Success: "0",
  "Minor Failure": "4",
  "Serious Failure": "8",
};

export function actionForRequest(
  method: CaqhHttpMethod,
  explicitAction?: CaqhAuditAction,
): FhirAuditActionCode {
  if (explicitAction) return ACTION_CODES[explicitAction];

  switch (method) {
    case "GET":
      return "R";
    case "POST":
      return "C";
    case "PUT":
    case "PATCH":
      return "U";
    case "DELETE":
      return "D";
  }
}

export function outcomeForStatus(
  status?: number,
  explicitOutcome?: CaqhAuditOutcome,
): FhirAuditOutcomeCode {
  if (explicitOutcome) return OUTCOME_CODES[explicitOutcome];
  if (status === undefined) return "8";
  if (status >= 200 && status < 400) return "0";
  if (status >= 400 && status < 500) return "4";
  return "8";
}

export function normalizeHttpMethod(method?: string): CaqhHttpMethod {
  const normalized = (method || "GET").trim().toUpperCase();
  if (
    normalized === "GET" ||
    normalized === "POST" ||
    normalized === "PUT" ||
    normalized === "PATCH" ||
    normalized === "DELETE"
  ) {
    return normalized;
  }

  throw new Error(`Unsupported CAQH HTTP method: ${normalized}`);
}

export function sanitizeAuditEndpoint(endpoint: string | URL): string {
  const url = endpoint instanceof URL ? new URL(endpoint.toString()) : new URL(endpoint);

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password
  ) {
    throw new Error("CAQH audit endpoints must use HTTPS without embedded credentials.");
  }

  return `${url.origin}${url.pathname}`;
}

export function validateAuditEntity(entity: CaqhAuditInput["entity"]): void {
  const id = entity.id.trim();

  if (!id || id.length > 255) {
    throw new Error("CAQH audit entity ID is invalid.");
  }

  if (entity.type === "Practitioner" && !/^\d{10}$/.test(id)) {
    throw new Error("Practitioner audit entity must contain a 10-digit NPI.");
  }
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";

  if (typeof value === "string") return JSON.stringify(value);
  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }

  if (value === undefined) return "undefined";

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(String(value));
}

export function sha256Payload(payload: unknown): string | null {
  if (payload === undefined) return null;

  return createHash("sha256")
    .update(canonicalize(payload), "utf8")
    .digest("hex");
}

export async function recordCaqhAuditEvent(
  database: CaqhAuditDatabase,
  input: CaqhAuditInput,
): Promise<FhirAuditEvent> {
  validateAuditEntity(input.entity);

  const method = normalizeHttpMethod(input.method);
  const endpoint = sanitizeAuditEndpoint(input.endpoint);
  const action = actionForRequest(method, input.action);
  const outcome = outcomeForStatus(input.httpStatus, input.outcome);
  const correlationId = input.correlationId ?? randomUUID();

  const result = await database.execute(sql`
    select audit.append_caqh_event(
      ${input.tenantId}::uuid,
      ${correlationId}::uuid,
      ${input.direction},
      ${action}::char(1),
      ${input.agent.type},
      ${input.agent.id.trim()},
      ${input.entity.type},
      ${input.entity.id.trim()},
      ${outcome}::char(1),
      ${input.outcomeDescription ?? null},
      ${method},
      ${endpoint},
      ${input.httpStatus ?? null},
      ${sha256Payload(input.requestPayload)},
      ${sha256Payload(input.responsePayload)},
      ${input.durationMs == null ? null : Math.max(0, Math.round(input.durationMs))}
    ) as audit_event
  `);

  const row = result.rows[0] as { audit_event?: FhirAuditEvent } | undefined;

  if (!row?.audit_event || row.audit_event.resourceType !== "AuditEvent") {
    throw new Error("CAQH audit append did not return a FHIR AuditEvent.");
  }

  return row.audit_event;
}

function errorDescription(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return `CAQH request failed before a response was received: ${error.message}`;
  }

  return "CAQH request failed before a response was received.";
}

/**
 * The only network helper CAQH directory clients should use.
 *
 * It fails closed before dispatch if the outbound audit entry cannot be
 * appended, records the inbound response with the same correlation ID, and
 * never persists Authorization headers, access tokens, query strings, or
 * response bodies. Optional request/response payloads are SHA-256 hashed only.
 */
export async function auditedCaqhFetch(
  database: CaqhAuditDatabase,
  input: AuditedCaqhFetchInput,
  dependencies: AuditedCaqhFetchDependencies = {},
): Promise<Response> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const auditWriter = dependencies.auditWriter ?? recordCaqhAuditEvent;
  const correlationId = randomUUID();
  const method = normalizeHttpMethod(input.init?.method);
  const endpoint = sanitizeAuditEndpoint(input.url);
  const startedAt = performance.now();

  await auditWriter(database, {
    tenantId: input.tenantId,
    correlationId,
    direction: "outbound",
    method,
    endpoint,
    action: input.action,
    agent: input.agent,
    entity: input.entity,
    outcome: "Success",
    outcomeDescription: "CAQH directory request dispatched.",
    requestPayload: input.requestPayloadForHash,
  });

  let response: Response;

  try {
    response = await fetchImpl(input.url, input.init);
  } catch (error) {
    await auditWriter(database, {
      tenantId: input.tenantId,
      correlationId,
      direction: "inbound",
      method,
      endpoint,
      action: input.action,
      agent: input.agent,
      entity: input.entity,
      outcome: "Serious Failure",
      outcomeDescription: errorDescription(error),
      durationMs: performance.now() - startedAt,
    });

    throw error;
  }

  await auditWriter(database, {
    tenantId: input.tenantId,
    correlationId,
    direction: "inbound",
    method,
    endpoint,
    action: input.action,
    agent: input.agent,
    entity: input.entity,
    httpStatus: response.status,
    outcomeDescription: response.ok
      ? "CAQH directory response received."
      : `CAQH directory returned HTTP ${response.status}.`,
    durationMs: performance.now() - startedAt,
  });

  return response;
}
