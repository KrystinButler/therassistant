import test from "node:test";
import assert from "node:assert/strict";

import {
  actionForRequest,
  auditedCaqhFetch,
  normalizeHttpMethod,
  outcomeForStatus,
  sanitizeAuditEndpoint,
  sha256Payload,
  validateAuditEntity,
  type CaqhAuditInput,
  type FhirAuditEvent,
} from "../../api-server/src/lib/caqh-audit";

const fakeAuditEvent: FhirAuditEvent = {
  resourceType: "AuditEvent",
  id: "audit-test",
  type: {
    system: "http://terminology.hl7.org/CodeSystem/audit-event-type",
    code: "rest",
  },
  action: "R",
  recorded: "2026-09-28T09:00:00.000000Z",
  outcome: "0",
  agent: [{ requestor: true }],
  source: {
    observer: {
      identifier: {
        system: "urn:therassistant:system",
        value: "ehr-api-gateway",
      },
    },
  },
};

test("CAQH audit action mapping uses FHIR R4 C/R/U/D codes", () => {
  assert.equal(actionForRequest("GET"), "R");
  assert.equal(actionForRequest("POST"), "C");
  assert.equal(actionForRequest("PUT"), "U");
  assert.equal(actionForRequest("PATCH"), "U");
  assert.equal(actionForRequest("DELETE"), "D");

  // Directory APIs sometimes use POST for a semantic query.
  assert.equal(actionForRequest("POST", "Read"), "R");
});

test("CAQH audit outcomes map success, client failure, and server failure", () => {
  assert.equal(outcomeForStatus(200), "0");
  assert.equal(outcomeForStatus(302), "0");
  assert.equal(outcomeForStatus(404), "4");
  assert.equal(outcomeForStatus(429), "4");
  assert.equal(outcomeForStatus(500), "8");
  assert.equal(outcomeForStatus(undefined), "8");

  assert.equal(outcomeForStatus(undefined, "Success"), "0");
  assert.equal(outcomeForStatus(200, "Serious Failure"), "8");
});

test("CAQH audit endpoint strips query strings and fragments", () => {
  assert.equal(
    sanitizeAuditEndpoint(
      "https://directory.example.test/practitioners?npi=1234567893#result",
    ),
    "https://directory.example.test/practitioners",
  );

  assert.throws(
    () => sanitizeAuditEndpoint("http://directory.example.test/practitioners"),
    /HTTPS/,
  );
});

test("Practitioner audit entity requires a 10-digit NPI", () => {
  assert.doesNotThrow(() =>
    validateAuditEntity({
      type: "Practitioner",
      id: "1234567893",
    }),
  );

  assert.throws(
    () =>
      validateAuditEntity({
        type: "Practitioner",
        id: "123456789",
      }),
    /10-digit NPI/,
  );

  assert.doesNotThrow(() =>
    validateAuditEntity({
      type: "Organization",
      id: "organization-42",
    }),
  );
});

test("payload hashing is deterministic across object key order", () => {
  const first = sha256Payload({
    npi: "1234567893",
    active: true,
  });

  const second = sha256Payload({
    active: true,
    npi: "1234567893",
  });

  assert.equal(first, second);
  assert.match(first ?? "", /^[0-9a-f]{64}$/);
});

test("HTTP method normalization rejects unsupported methods", () => {
  assert.equal(normalizeHttpMethod("get"), "GET");
  assert.equal(normalizeHttpMethod(undefined), "GET");
  assert.throws(() => normalizeHttpMethod("OPTIONS"), /Unsupported CAQH HTTP method/);
});

test("audited CAQH fetch records outbound and inbound events with one correlation ID", async () => {
  const writes: CaqhAuditInput[] = [];

  const auditWriter = async (_database: any, input: CaqhAuditInput) => {
    writes.push(input);
    return fakeAuditEvent;
  };

  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });

  const response = await auditedCaqhFetch(
    {} as any,
    {
      tenantId: "11111111-1111-4111-8111-111111111111",
      url: "https://directory.example.test/practitioners?npi=1234567893",
      init: {
        method: "GET",
        headers: {
          Authorization: "Bearer secret-that-must-not-be-logged",
        },
      },
      action: "Read",
      agent: {
        type: "client",
        id: "caqh-directory-client",
      },
      entity: {
        type: "Practitioner",
        id: "1234567893",
      },
    },
    {
      auditWriter,
      fetchImpl,
    },
  );

  assert.equal(response.status, 200);
  assert.equal(writes.length, 2);

  assert.equal(writes[0].direction, "outbound");
  assert.equal(writes[1].direction, "inbound");
  assert.equal(writes[0].correlationId, writes[1].correlationId);

  assert.equal(
    writes[0].endpoint,
    "https://directory.example.test/practitioners",
  );
  assert.equal(
    writes[1].endpoint,
    "https://directory.example.test/practitioners",
  );

  assert.equal(writes[0].outcome, "Success");
  assert.equal(writes[1].httpStatus, 200);

  const serializedWrites = JSON.stringify(writes);
  assert.equal(serializedWrites.includes("secret-that-must-not-be-logged"), false);
});

test("network failure creates a serious-failure inbound audit entry", async () => {
  const writes: CaqhAuditInput[] = [];

  const auditWriter = async (_database: any, input: CaqhAuditInput) => {
    writes.push(input);
    return fakeAuditEvent;
  };

  const fetchImpl: typeof fetch = async () => {
    throw new Error("connection reset");
  };

  await assert.rejects(
    () =>
      auditedCaqhFetch(
        {} as any,
        {
          tenantId: "11111111-1111-4111-8111-111111111111",
          url: "https://directory.example.test/organizations/abc",
          init: {
            method: "GET",
          },
          action: "Read",
          agent: {
            type: "system",
            id: "directory-sync",
          },
          entity: {
            type: "Organization",
            id: "abc",
          },
        },
        {
          auditWriter,
          fetchImpl,
        },
      ),
    /connection reset/,
  );

  assert.equal(writes.length, 2);
  assert.equal(writes[0].direction, "outbound");
  assert.equal(writes[1].direction, "inbound");
  assert.equal(writes[1].outcome, "Serious Failure");
  assert.match(writes[1].outcomeDescription ?? "", /connection reset/);
});
