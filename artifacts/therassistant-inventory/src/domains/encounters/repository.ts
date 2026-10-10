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

type FeeRateRow = Row & {
  payer_id?: string | null;
  provider_level?: string | null;
  cpt_code?: string | null;
  code?: string | null;
  modifier?: string | null;
  rate_cents?: number | string | null;
  fee_schedule_status?: string | null;
  effective_date?: string | null;
  termination_date?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
  is_reference?: boolean | null;
};

export type EncounterServiceFee = {
  rateCents: number;
  source: "tenant" | "reference";
  providerLevel: "Masters-Level" | "Prescriber-Level";
};

function providerFeeLevel(provider?: Row | null): EncounterServiceFee["providerLevel"] {
  const profile = [provider?.credentials, provider?.primary_specialty, provider?.taxonomy_code]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  return /\b(MD|DO|NP|APRN|PMHNP|PA-C|PHYSICIAN|PSYCHIATR|NURSE PRACTITIONER|PHYSICIAN ASSISTANT)\b/.test(profile)
    ? "Prescriber-Level"
    : "Masters-Level";
}

function inFeeDateRange(row: FeeRateRow, serviceDate: string) {
  const start = String(row.effective_date ?? row.effective_from ?? "");
  const end = String(row.termination_date ?? row.effective_to ?? "");
  return (!start || start <= serviceDate) && (!end || end >= serviceDate);
}

function chooseFeeRate(rows: FeeRateRow[], serviceDate: string, modifier: string, providerLevel: EncounterServiceFee["providerLevel"]) {
  const wantedModifier = modifier.trim().toUpperCase();
  return rows
    .filter((row) => {
      const rowModifier = String(row.modifier ?? "").trim().toUpperCase();
      const rowProviderLevel = String(row.provider_level ?? "").trim();
      return inFeeDateRange(row, serviceDate)
        && (!rowModifier || rowModifier === wantedModifier)
        && (!rowProviderLevel || rowProviderLevel === providerLevel);
    })
    .sort((a, b) => {
      const score = (row: FeeRateRow) =>
        (String(row.modifier ?? "").trim().toUpperCase() === wantedModifier && wantedModifier ? 4 : 0)
        + (String(row.provider_level ?? "").trim() === providerLevel ? 2 : 0)
        + (row.payer_id ? 1 : 0);
      return score(b) - score(a)
        || String(b.effective_date ?? b.effective_from ?? "").localeCompare(String(a.effective_date ?? a.effective_from ?? ""));
    })[0] ?? null;
}

export async function getEncounterServiceFee(
  encounterId: string,
  cptCode: string,
  modifier = "",
  requestedServiceDate?: string,
): Promise<EncounterServiceFee | null> {
  const code = cptCode.trim().toUpperCase();
  if (!encounterId || !code) return null;

  const encounter = first(await tenantSelect<DataRow>("encounters", { id: `eq.${encounterId}`, limit: "1" }));
  if (!encounter) return null;
  const serviceDate = requestedServiceDate || String(encounter.started_at ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  const provider = encounter.provider_id
    ? first(await tenantSelect<DataRow>("providers", { id: `eq.${String(encounter.provider_id)}`, limit: "1" }))
    : null;
  const providerLevel = providerFeeLevel(provider);
  const payerId = String(encounter.payer_id ?? "").trim();

  const tenantRates = await tenantSelect<FeeRateRow>("v_fee_schedule_rates", { cpt_code: `eq.${code}` });
  const tenantCandidates = tenantRates.filter((row) =>
    String(row.fee_schedule_status ?? "").toLowerCase() === "active"
    && row.is_reference !== true
    && (!row.payer_id || String(row.payer_id) === payerId),
  );
  const tenantRate = chooseFeeRate(tenantCandidates, serviceDate, modifier, providerLevel);
  if (tenantRate && Number(tenantRate.rate_cents) > 0) {
    return { rateCents: Number(tenantRate.rate_cents), source: "tenant", providerLevel };
  }

  if (!payerId) return null;
  const referenceRates = await referenceSelect<FeeRateRow>("v_reference_fee_rates", {
    payer_id: `eq.${payerId}`,
    code: `eq.${code}`,
  });
  const referenceRate = chooseFeeRate(referenceRates, serviceDate, modifier, providerLevel);
  if (!referenceRate || Number(referenceRate.rate_cents) <= 0) return null;
  return { rateCents: Number(referenceRate.rate_cents), source: "reference", providerLevel };
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
    readinessChecks,
    notes,
    treatmentPlans,
    checkins,
    journalEntries,
    documents,
    outcomeMeasures,
    safetyScreenings,
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
    tenantSelect<DataRow>("clinical_outcome_measures", {
      client_id: `eq.${String(encounter.client_id)}`,
      order: "assessed_on.desc,created_at.desc",
    }),
    tenantSelect<DataRow>("clinical_safety_screenings", {
      client_id: `eq.${String(encounter.client_id)}`,
      instrument: "eq.C-SSRS",
      order: "assessed_on.desc,created_at.desc",
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

  // Keep billing-only service-line edits available after the clinical note is signed.
  // A charge-captured line must instead be corrected in its revenue-cycle workqueue.
  const chargeLines = serviceLines.length
    ? await tenantSelect<DataRow>("charge_capture_items", {
        service_line_id: `in.(${serviceLines.map((row) => row.id).join(",")})`,
      })
    : [];

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
    chargeLines,
    claims: linkedClaims,
    readinessChecks,
    notes,
    signatures,
    treatmentPlans,
    treatmentPlanGoals: goalRows,
    checkins,
    journalEntries,
    documents,
    outcomeMeasures,
    safetyScreenings,
  };
}

export function updateEncounter(id: string, values: Row) {
  return tenantUpdate<DataRow>("encounters", id, values);
}
