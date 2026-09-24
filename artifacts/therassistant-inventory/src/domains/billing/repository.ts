import {
  tenantInsert,
  tenantSelect,
  tenantUpdate,
  referenceSelect,
  type Row,
} from "../../lib/tenant-data-client";
import type { BillingReadinessInput } from "../readiness/evaluate-billing-readiness";
import {
  fundingSourceLabel,
  resolveEncounterFunding,
} from "./funding-source";
import {
  createChargeFromEncounterWorkflow,
  routeEncounterToBillingWorkflow,
  type BillingRepository,
} from "./workflow";

type DataRow = Row & { id: string };
type BillingQueueEncounter = DataRow & {
  billingType: string;
  fundingSourceType: string;
  fundingSourceSubtype: string;
  billingPath: string;
  fundingSourceLabel: string;
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
    await tenantSelect<DataRow>("encounters", { id: `eq.${encounterId}`, limit: "1" }),
  );
  if (!encounter) throw new Error("Encounter not found.");

  const [clients, notes, diagnoses, serviceLines, eligibilityRows, enrollmentRows] = await Promise.all([
    tenantSelect<DataRow>("clients", { id: `eq.${String(encounter.client_id)}`, limit: "1" }),
    tenantSelect<DataRow>("clinical_notes", { encounter_id: `eq.${encounterId}`, order: "created_at.desc", limit: "1" }),
    tenantSelect<DataRow>("encounter_diagnoses", { encounter_id: `eq.${encounterId}`, order: "sequence_number.asc" }),
    tenantSelect<DataRow>("encounter_service_lines", { encounter_id: `eq.${encounterId}`, order: "created_at.asc" }),
    tenantSelect<DataRow>("eligibility_checks", {
      client_id: `eq.${String(encounter.client_id)}`,
      ...(encounter.insurance_policy_id ? { insurance_policy_id: `eq.${String(encounter.insurance_policy_id)}` } : {}),
      order: "created_at.desc",
      limit: "1",
    }),
    encounter.provider_id && encounter.payer_id
      ? tenantSelect<DataRow>("provider_payer_enrollments", {
          provider_id: `eq.${String(encounter.provider_id)}`,
          payer_id: `eq.${String(encounter.payer_id)}`,
          order: "created_at.desc",
          limit: "1",
        })
      : Promise.resolve([]),
  ]);

  const client = first(clients);
  const legacyBillingType = String(metadata(client).billing_type ?? "insurance");
  const funding = resolveEncounterFunding(encounter, legacyBillingType);
  const billingType = funding.billingPath === "private_pay" ? "self_pay" : "insurance";
  return {
    encounter,
    billingType,
    fundingSourceType: funding.sourceType,
    fundingSourceSubtype: funding.sourceSubtype,
    billingPath: funding.billingPath,
    fundingContext: funding.context,
    note: first(notes),
    diagnoses,
    serviceLines,
    eligibilityStatus: first(eligibilityRows)
      ? String(first(eligibilityRows)?.eligibility_status ?? "")
      : null,
    providerEnrollmentStatus: first(enrollmentRows)
      ? String(first(enrollmentRows)?.enrollment_status ?? "unknown")
      : null,
  };
}

const repository: BillingRepository = {
  getBillingContext,

  async replaceReadinessChecks(encounterId, checks) {
    const existing = await tenantSelect<DataRow>("encounter_readiness_checks", {
      encounter_id: `eq.${encounterId}`,
    });
    const existingByCode = new Map(existing.map((row) => [String(row.check_code), row]));
    const currentCodes = new Set(checks.map((check) => String(check.check_code)));

    for (const stale of existing.filter((row) => !currentCodes.has(String(row.check_code)))) {
      await tenantUpdate<DataRow>("encounter_readiness_checks", stale.id, {
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
        await tenantUpdate<DataRow>("encounter_readiness_checks", current.id, check);
      } else {
        await tenantInsert<DataRow>("encounter_readiness_checks", {
          encounter_id: encounterId,
          ...check,
        });
      }
    }
  },

  async upsertWorkItem(values) {
    const sourceId = String(values.source_object_id ?? "");
    const type = String(values.workqueue_type ?? "general_task");
    const existing = await tenantSelect<DataRow>("workqueue_items", {
      source_object_type: "eq.encounter",
      source_object_id: `eq.${sourceId}`,
      workqueue_type: `eq.${type}`,
      workqueue_status: "in.(open,in_progress,pending,snoozed,reopened)",
      limit: "1",
    });
    if (existing[0]) return tenantUpdate<DataRow>("workqueue_items", existing[0].id, values);
    return tenantInsert<DataRow>("workqueue_items", values);
  },

  async resolveStaleWorkItems(encounterId, activeTypes) {
    const billingTypes = new Set([
      "eligibility_issue",
      "credentialing_issue",
      "missing_documentation",
      "charge_validation",
    ]);
    const active = new Set(activeTypes);
    const existing = await tenantSelect<DataRow>("workqueue_items", {
      source_object_type: "eq.encounter",
      source_object_id: `eq.${encounterId}`,
      workqueue_status: "in.(open,in_progress,pending,snoozed,reopened)",
    });

    for (const item of existing) {
      const type = String(item.workqueue_type ?? "");
      if (!billingTypes.has(type) || active.has(type)) continue;
      await tenantUpdate<DataRow>("workqueue_items", item.id, {
        workqueue_status: "completed",
        completed_at: new Date().toISOString(),
      });
    }
  },

  updateEncounter(id, values) {
    return tenantUpdate<DataRow>("encounters", id, values);
  },

  getExistingCharges(encounterId) {
    return tenantSelect<DataRow>("charge_capture_items", {
      encounter_id: `eq.${encounterId}`,
      order: "created_at.asc",
    });
  },

  createCharge(values) {
    return tenantInsert<DataRow>("charge_capture_items", values);
  },

  updateCharge(id, values) {
    return tenantUpdate<DataRow>("charge_capture_items", id, values);
  },

  updateServiceLine(id, values) {
    return tenantUpdate<DataRow>("encounter_service_lines", id, values);
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
    tenantSelect<DataRow>("encounters", { order: "updated_at.desc" }),
    tenantSelect<DataRow>("clients"),
    tenantSelect<DataRow>("providers"),
    tenantSelect<DataRow>("charge_capture_items", { order: "created_at.desc" }),
    referenceSelect<DataRow>("payers", { order: "name.asc" }),
    tenantSelect<DataRow>("encounter_readiness_checks"),
  ]);

  const clientsById = new Map(clients.map((row) => [row.id, row]));
  const providersById = new Map(providers.map((row) => [row.id, row]));
  const payersById = new Map(payers.map((row) => [row.id, row]));

  const displayName = (row?: Row) =>
    row ? [row.first_name, row.last_name].filter(Boolean).join(" ") || "—" : "—";

  const encounterRows = encounters.map((encounter): BillingQueueEncounter => {
    const client = clientsById.get(String(encounter.client_id));
    const legacyBillingType = String(metadata(client).billing_type ?? "insurance");
    const funding = resolveEncounterFunding(encounter, legacyBillingType);
    const billingType = funding.billingPath === "private_pay" ? "self_pay" : "insurance";
    const responsibleEntity = String(funding.context.responsible_entity ?? "").trim();
    const payerName =
      funding.billingPath === "insurance_claim"
        ? String(payersById.get(String(encounter.payer_id))?.name ?? "—")
        : funding.billingPath === "program_invoice_voucher"
          ? responsibleEntity || "Government / Program"
          : responsibleEntity || "Private Pay";
    return {
      ...encounter,
      billingType,
      fundingSourceType: funding.sourceType,
      fundingSourceSubtype: funding.sourceSubtype,
      billingPath: funding.billingPath,
      fundingSourceLabel: fundingSourceLabel(funding.sourceType),
      clientName: displayName(client),
      providerName: displayName(providersById.get(String(encounter.provider_id))),
      payerName,
      blockingChecks: readinessChecks.filter(
        (check) => check.encounter_id === encounter.id && check.blocking === true,
      ),
    };
  });

  const chargesByEncounter = new Map<string, DataRow[]>();
  for (const charge of charges) {
    const key = String(charge.encounter_id ?? "");
    const list = chargesByEncounter.get(key) ?? [];
    list.push(charge);
    chargesByEncounter.set(key, list);
  }

  return { encounters: encounterRows, charges, chargesByEncounter };
}
