import {
  tenantInsert,
  tenantSelect,
  tenantUpdate,
  referenceSelect,
  type Row,
} from "../../lib/tenant-data-client";
import { getPreSessionData } from "../scheduling/repository";
import { buildDirectDocumentationDraft, type DirectDocumentationInput } from "./direct-documentation";
import {
  billingPathForFundingSource,
  legacyFundingSourceType,
} from "../billing/funding-source";
import {
  startEncounterWorkflow,
  type AppointmentForEncounter,
  type EncounterRecord,
  type EncounterRepository,
} from "./workflow";

type DataRow = Row & { id: string };
type ReadinessCheckRow = DataRow & {
  action?: string | null;
  check_code?: string | null;
  check_status?: string | null;
  message?: string | null;
};

function first<T>(rows: T[]) {
  return rows[0] ?? null;
}

const repository: EncounterRepository = {
  async getAppointment(id) {
    const row = first(await tenantSelect<DataRow>("appointments", { id: `eq.${id}`, limit: "1" }));
    if (!row) return null;
    return {
      id: row.id,
      client_id: String(row.client_id ?? ""),
      provider_id: row.provider_id ? String(row.provider_id) : null,
      appointment_status: String(row.appointment_status ?? "scheduled"),
      location_type: row.location_type ? String(row.location_type) : null,
      service_type: row.service_type ? String(row.service_type) : null,
    } satisfies AppointmentForEncounter;
  },

  async getExistingEncounterByAppointment(id) {
    return first(
      await tenantSelect<EncounterRecord>("encounters", {
        appointment_id: `eq.${id}`,
        limit: "1",
      }),
    );
  },

  async getPreSessionContext(id) {
    const { appointment } = await getPreSessionData(id);
    const fundingSourceType = legacyFundingSourceType(appointment.billingType);
    return {
      readiness: appointment.readiness,
      policyId: appointment.policyId,
      payerId: appointment.payerId,
      fundingSourceType,
      billingPath: billingPathForFundingSource(fundingSourceType),
    };
  },

  createEncounter(values) {
    return tenantInsert<EncounterRecord>("encounters", values);
  },

  updateAppointment(id, values) {
    return tenantUpdate<DataRow>("appointments", id, values);
  },
};

export function startEncounter(appointmentId: string) {
  return startEncounterWorkflow(repository, appointmentId);
}

/** Create an actual tenant-scoped clinical encounter without a fabricated appointment. */
export async function createUnscheduledEncounter(input: DirectDocumentationInput): Promise<EncounterRecord> {
  const values = buildDirectDocumentationDraft(input);
  const [clients, providers] = await Promise.all([
    tenantSelect<DataRow>("clients", { id: `eq.${values.client_id}`, limit: "1" }),
    tenantSelect<DataRow>("providers", { id: `eq.${values.provider_id}`, limit: "1" }),
  ]);
  if (!clients.length) throw new Error("Selected patient is not available in this practice.");
  if (!providers.length) throw new Error("Selected provider is not available in this practice.");
  return tenantInsert<EncounterRecord>("encounters", values);
}

export async function getEncounterDetail(encounterId: string) {
  const encounter = first(
    await tenantSelect<DataRow>("encounters", { id: `eq.${encounterId}`, limit: "1" }),
  );
  if (!encounter) throw new Error("Encounter not found.");

  const [
    clientRows,
    providerRows,
    appointmentRows,
    diagnoses,
    serviceLines,
    claims: linkedClaims,
    readinessChecks,
    notes,
    treatmentPlans,
    checkins,
    journalEntries,
    documents,
  ] = await Promise.all([
    tenantSelect<DataRow>("clients", { id: `eq.${String(encounter.client_id)}`, limit: "1" }),
    encounter.provider_id
      ? tenantSelect<DataRow>("providers", { id: `eq.${String(encounter.provider_id)}`, limit: "1" })
      : Promise.resolve([]),
    encounter.appointment_id
      ? tenantSelect<DataRow>("appointments", { id: `eq.${String(encounter.appointment_id)}`, limit: "1" })
      : Promise.resolve([]),
    tenantSelect<DataRow>("encounter_diagnoses", {
      encounter_id: `eq.${encounterId}`,
      order: "sequence_number.asc",
    }),
    tenantSelect<DataRow>("encounter_service_lines", {
      encounter_id: `eq.${encounterId}`,
      order: "created_at.asc",
    }),
    tenantSelect<ReadinessCheckRow>("encounter_readiness_checks", {
      encounter_id: `eq.${encounterId}`,
      order: "evaluated_at.desc",
    }),
    tenantSelect<DataRow>("clinical_notes", {
      encounter_id: `eq.${encounterId}`,
      order: "created_at.desc",
    }),
    tenantSelect<DataRow>("treatment_plans", {
      client_id: `eq.${String(encounter.client_id)}`,
      order: "effective_date.desc",
    }),
    tenantSelect<DataRow>("client_checkins", {
      client_id: `eq.${String(encounter.client_id)}`,
      order: "created_at.desc",
    }),
    tenantSelect<DataRow>("patient_journal_entries", {
      client_id: `eq.${String(encounter.client_id)}`,
      order: "entry_date.desc,created_at.desc",
    }),
    tenantSelect<DataRow>("documents", {
      client_id: `eq.${String(encounter.client_id)}`,
      order: "created_at.desc",
    }),
  ]);

  const policyRows = encounter.insurance_policy_id
    ? await tenantSelect<DataRow>("client_insurance_policies", {
        id: `eq.${String(encounter.insurance_policy_id)}`,
        limit: "1",
      })
    : [];
  const policy = first(policyRows);

  const [payerRows, planRows, goalRows, signatures, linkedClaims] = await Promise.all([
    encounter.payer_id
      ? referenceSelect<DataRow>("payers", { id: `eq.${String(encounter.payer_id)}`, limit: "1" })
      : Promise.resolve([]),
    policy?.payer_plan_id
      ? referenceSelect<DataRow>("payer_plans", { id: `eq.${String(policy.payer_plan_id)}`, limit: "1" })
      : Promise.resolve([]),
    treatmentPlans.length
      ? tenantSelect<DataRow>("treatment_plan_goals", {
          treatment_plan_id: `in.(${treatmentPlans.map((row) => row.id).join(",")})`,
          order: "created_at.asc",
        })
      : Promise.resolve([]),
    notes.length
      ? tenantSelect<DataRow>("clinical_note_signatures", {
          clinical_note_id: `in.(${notes.map((row) => row.id).join(",")})`,
          order: "signed_at.desc",
        })
      : Promise.resolve([]),
    tenantSelect<DataRow>("professional_claims", { source_encounter_id: `eq.${encounterId}`, order: "created_at.desc" }),
  ]);

  return {
    encounter,
    client: first(clientRows),
    provider: first(providerRows),
    appointment: first(appointmentRows),
    policy,
    payer: first(payerRows),
    plan: first(planRows),
    diagnoses,
    serviceLines,
    readinessChecks,
    notes,
    signatures,
    treatmentPlans,
    treatmentPlanGoals: goalRows,
    checkins,
    journalEntries,
    documents,
  };
}

export function updateEncounter(id: string, values: Row) {
  return tenantUpdate<DataRow>("encounters", id, values);
}
