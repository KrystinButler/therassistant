import {
  demoInsert,
  demoSelect,
  demoUpdate,
  referenceSelect,
  type Row,
} from "../../lib/supabase-demo-client";
import type { BillingReadinessInput } from "../readiness/evaluate-billing-readiness";
import {
  createChargeFromEncounterWorkflow,
  routeEncounterToBillingWorkflow,
  type BillingRepository,
} from "./workflow";

type DataRow = Row & { id: string };
type BillingQueueEncounter = DataRow & {
  clientName: string;
  providerName: string;
  payerName: string;
  blockingChecks: DataRow[];
};

function first<T>(rows: T[]) {
  return rows[0] ?? null;
}

function metadata(row?: Row | null) {
  return row?.metadata && typeof row.metadata === "object"
    ? (row.metadata as Record<string, unknown>)
    : {};
}

async function getBillingContext(encounterId: string): Promise<BillingReadinessInput> {
  const encounter = first(
    await demoSelect<DataRow>("encounters", { id: `eq.${encounterId}`, limit: "1" }),
  );
  if (!encounter) throw new Error("Encounter not found.");

  const [notes, diagnoses, serviceLines, policies, eligibilityRows, authorizationRows, enrollmentRows] = await Promise.all([
    demoSelect<DataRow>("clinical_notes", { encounter_id: `eq.${encounterId}`, order: "created_at.desc", limit: "1" }),
    demoSelect<DataRow>("encounter_diagnoses", { encounter_id: `eq.${encounterId}`, order: "sequence_number.asc" }),
    demoSelect<DataRow>("encounter_service_lines", { encounter_id: `eq.${encounterId}`, order: "created_at.asc" }),
    encounter.insurance_policy_id
      ? demoSelect<DataRow>("client_insurance_policies", { id: `eq.${String(encounter.insurance_policy_id)}`, limit: "1" })
      : Promise.resolve([]),
    demoSelect<DataRow>("eligibility_checks", {
      client_id: `eq.${String(encounter.client_id)}`,
      ...(encounter.insurance_policy_id ? { insurance_policy_id: `eq.${String(encounter.insurance_policy_id)}` } : {}),
      order: "created_at.desc",
      limit: "1",
    }),
    demoSelect<DataRow>("authorizations", {
      client_id: `eq.${String(encounter.client_id)}`,
      ...(encounter.payer_id ? { payer_id: `eq.${String(encounter.payer_id)}` } : {}),
      order: "created_at.desc",
    }),
    encounter.provider_id && encounter.payer_id
      ? demoSelect<DataRow>("provider_payer_enrollments", {
          provider_id: `eq.${String(encounter.provider_id)}`,
          payer_id: `eq.${String(encounter.payer_id)}`,
          order: "created_at.desc",
          limit: "1",
        })
      : Promise.resolve([]),
  ]);

  const policy = first(policies);
  const policyMetadata = metadata(policy);
  const authorizationRequired = policyMetadata.authorization_required === true;
  const authorization =
    authorizationRows.find((row) => row.status === "approved") ?? authorizationRows[0] ?? null;
  const units = authorization
    ? await demoSelect<DataRow>("authorization_units", {
        authorization_id: `eq.${authorization.id}`,
      })
    : [];
  const remainingUnits = units.length
    ? units.reduce((sum, row) => sum + Number(row.remaining_units ?? 0), 0)
    : null;

  return {
    encounter,
    note: first(notes),
    diagnoses,
    serviceLines,
    eligibilityStatus: first(eligibilityRows)
      ? String(first(eligibilityRows)?.eligibility_status ?? "")
      : null,
    authorizationRequired,
    authorizationStatus: authorization ? String(authorization.status ?? "unknown") : null,
    remainingUnits,
    providerEnrollmentStatus: first(enrollmentRows)
      ? String(first(enrollmentRows)?.enrollment_status ?? "unknown")
      : null,
  };
}

const repository: BillingRepository = {
  getBillingContext,

  async replaceReadinessChecks(encounterId, checks) {
    const existing = await demoSelect<DataRow>("encounter_readiness_checks", {
      encounter_id: `eq.${encounterId}`,
    });
    const existingByCode = new Map(existing.map((row) => [String(row.check_code), row]));
    const currentCodes = new Set(checks.map((check) => String(check.check_code)));

    for (const stale of existing.filter((row) => !currentCodes.has(String(row.check_code)))) {
      await demoUpdate<DataRow>("encounter_readiness_checks", stale.id, {
        check_status: "pass",
        blocking: false,
        message: "Superseded by the latest billing-readiness audit.",
        action: null,
        evaluated_at: new Date().toISOString(),
      });
    }

    for (const check of checks) {
      const code = String(check.check_code);
      const current = existingByCode.get(code);
      if (current) {
        await demoUpdate<DataRow>("encounter_readiness_checks", current.id, check);
      } else {
        await demoInsert<DataRow>("encounter_readiness_checks", {
          encounter_id: encounterId,
          ...check,
        });
      }
    }
  },

  async upsertWorkItem(values) {
    const sourceId = String(values.source_object_id ?? "");
    const type = String(values.workqueue_type ?? "general_task");
    const existing = await demoSelect<DataRow>("workqueue_items", {
      source_object_type: "eq.encounter",
      source_object_id: `eq.${sourceId}`,
      workqueue_type: `eq.${type}`,
      workqueue_status: "in.(open,in_progress,pending,snoozed,reopened)",
      limit: "1",
    });
    if (existing[0]) return demoUpdate<DataRow>("workqueue_items", existing[0].id, values);
    return demoInsert<DataRow>("workqueue_items", values);
  },

  updateEncounter(id, values) {
    return demoUpdate<DataRow>("encounters", id, values);
  },

  getExistingCharges(encounterId) {
    return demoSelect<DataRow>("charge_capture_items", {
      encounter_id: `eq.${encounterId}`,
      order: "created_at.asc",
    });
  },

  createCharge(values) {
    return demoInsert<DataRow>("charge_capture_items", values);
  },

  updateServiceLine(id, values) {
    return demoUpdate<DataRow>("encounter_service_lines", id, values);
  },
};

export function routeEncounterToBilling(encounterId: string) {
  return routeEncounterToBillingWorkflow(repository, encounterId);
}

export function createChargeFromEncounter(encounterId: string) {
  return createChargeFromEncounterWorkflow(repository, encounterId);
}

export async function getBillingQueueData() {
  const [encounters, clients, providers, charges, payers, readinessChecks] = await Promise.all([
    demoSelect<DataRow>("encounters", { order: "updated_at.desc" }),
    demoSelect<DataRow>("clients"),
    demoSelect<DataRow>("providers"),
    demoSelect<DataRow>("charge_capture_items", { order: "created_at.desc" }),
    referenceSelect<DataRow>("payers", { order: "name.asc" }),
    demoSelect<DataRow>("encounter_readiness_checks"),
  ]);

  const clientsById = new Map(clients.map((row) => [row.id, row]));
  const providersById = new Map(providers.map((row) => [row.id, row]));
  const payersById = new Map(payers.map((row) => [row.id, row]));

  const displayName = (row?: Row) =>
    row ? [row.first_name, row.last_name].filter(Boolean).join(" ") || "—" : "—";

  const encounterRows = encounters.map((encounter): BillingQueueEncounter => ({
    ...encounter,
    clientName: displayName(clientsById.get(String(encounter.client_id))),
    providerName: displayName(providersById.get(String(encounter.provider_id))),
    payerName: String(payersById.get(String(encounter.payer_id))?.name ?? "—"),
    blockingChecks: readinessChecks.filter(
      (check) => check.encounter_id === encounter.id && check.blocking === true,
    ),
  }));

  const chargesByEncounter = new Map<string, DataRow[]>();
  for (const charge of charges) {
    const key = String(charge.encounter_id ?? "");
    const list = chargesByEncounter.get(key) ?? [];
    list.push(charge);
    chargesByEncounter.set(key, list);
  }

  return { encounters: encounterRows, charges, chargesByEncounter };
}
