import type { Row } from "../../lib/tenant-data-client";

export type AuthorizationDraft = {
  payerId: string;
  authorizationNumber?: string;
  status: "not_required" | "pending" | "approved" | "denied" | "expired" | "exhausted" | "cancelled" | "unknown";
  startDate?: string;
  endDate?: string;
  notes?: string;
};

export type AuthorizationUnitDraft = {
  cptCode?: string;
  authorizedUnits: number;
  usedUnits?: number;
};

export function buildAuthorizationValues(input: AuthorizationDraft): Row {
  if (!input.payerId.trim()) throw new Error("Select a payer.");
  return {
    payer_id: input.payerId,
    authorization_number: input.authorizationNumber?.trim() || null,
    status: input.status,
    start_date: input.startDate || null,
    end_date: input.endDate || null,
    notes: input.notes?.trim() || null,
  };
}

export function buildAuthorizationUnitValues(input: AuthorizationUnitDraft): Row {
  const authorized = Number(input.authorizedUnits);
  const used = Number(input.usedUnits ?? 0);
  if (!Number.isFinite(authorized) || authorized < 0) throw new Error("Authorized units must be zero or greater.");
  if (!Number.isFinite(used) || used < 0) throw new Error("Used units must be zero or greater.");
  if (used > authorized) throw new Error("Used units cannot exceed authorized units.");
  return {
    cpt_code: input.cptCode?.trim() || null,
    authorized_units: authorized,
    used_units: used,
  };
}

export function planAuthorizationUse(input: {
  authorizedUnits: number;
  usedUnits: number;
  requestedUnits: number;
}) {
  if (input.requestedUnits <= 0) throw new Error("Units used must be greater than zero.");
  const remaining = input.authorizedUnits - input.usedUnits;
  if (input.requestedUnits > remaining) throw new Error("Requested use exceeds remaining units.");
  return input.usedUnits + input.requestedUnits;
}

export function authorizationAlert(
  input: { status: string; endDate?: string | null; remainingUnits?: number | null },
  today = new Date(),
) {
  const endDate = input.endDate ? new Date(`${input.endDate}T23:59:59`) : null;
  if (endDate && endDate.getTime() < today.getTime()) {
    return { code: "expired", blocking: true, message: "Authorization expired." } as const;
  }
  if (input.status !== "approved") {
    return { code: input.status || "missing", blocking: input.status !== "not_required", message: `Authorization is ${input.status || "missing"}.` } as const;
  }
  const remaining = input.remainingUnits;
  if (remaining !== null && remaining !== undefined && remaining <= 0) {
    return { code: "exhausted", blocking: true, message: "No authorized units remain." } as const;
  }
  if (remaining !== null && remaining !== undefined && remaining <= 2) {
    return { code: "low_units", blocking: false, message: `${remaining} authorized units remain.` } as const;
  }
  return { code: "ready", blocking: false, message: "Authorization is active." } as const;
}
