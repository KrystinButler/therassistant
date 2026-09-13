import { demoInsert, demoSelect, demoUpdate, type Row } from "../../lib/supabase-demo-client";
import {
  authorizationAlert,
  buildAuthorizationUnitValues,
  buildAuthorizationValues,
  planAuthorizationUse,
  type AuthorizationDraft,
  type AuthorizationUnitDraft,
} from "./workflow";

type DataRow = Row & { id: string };

export async function createAuthorization(patientId: string, input: AuthorizationDraft) {
  return demoInsert<DataRow>("authorizations", {
    client_id: patientId,
    ...buildAuthorizationValues(input),
  });
}

export function updateAuthorization(authorizationId: string, input: AuthorizationDraft) {
  return demoUpdate<DataRow>("authorizations", authorizationId, buildAuthorizationValues(input));
}

export async function setAuthorizationUnits(authorizationId: string, input: AuthorizationUnitDraft) {
  const existing = await demoSelect<DataRow>("authorization_units", {
    authorization_id: `eq.${authorizationId}`,
    cpt_code: input.cptCode ? `eq.${input.cptCode}` : "is.null",
    limit: "1",
  });
  const values = {
    authorization_id: authorizationId,
    ...buildAuthorizationUnitValues(input),
  };
  return existing[0]
    ? demoUpdate<DataRow>("authorization_units", existing[0].id, values)
    : demoInsert<DataRow>("authorization_units", values);
}

export async function recordAuthorizationUse(authorizationId: string, cptCode: string, units: number) {
  const rows = await demoSelect<DataRow>("authorization_units", {
    authorization_id: `eq.${authorizationId}`,
    cpt_code: `eq.${cptCode}`,
    limit: "1",
  });
  const row = rows[0];
  if (!row) throw new Error("Authorization units were not found for this CPT code.");
  const usedUnits = planAuthorizationUse({
    authorizedUnits: Number(row.authorized_units ?? 0),
    usedUnits: Number(row.used_units ?? 0),
    requestedUnits: units,
  });
  return demoUpdate<DataRow>("authorization_units", row.id, { used_units: usedUnits });
}

export async function getAuthorizationWorkspace(patientId: string) {
  const [authorizations, units] = await Promise.all([
    demoSelect<DataRow>("authorizations", { client_id: `eq.${patientId}`, order: "created_at.desc" }),
    demoSelect<DataRow>("authorization_units", { order: "created_at.asc" }),
  ]);
  return authorizations.map((authorization) => {
    const authUnits = units.filter((row) => row.authorization_id === authorization.id);
    const remaining = authUnits.reduce((sum, row) => sum + Number(row.remaining_units ?? 0), 0);
    return {
      ...authorization,
      units: authUnits,
      alert: authorizationAlert({
        status: String(authorization.status ?? "unknown"),
        endDate: authorization.end_date ? String(authorization.end_date) : null,
        remainingUnits: authUnits.length ? remaining : null,
      }),
    };
  });
}
