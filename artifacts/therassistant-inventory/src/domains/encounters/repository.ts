import {
  demoInsert,
  demoSelect,
  demoUpdate,
  referenceSelect,
  type Row,
} from "../../lib/supabase-demo-client";
import { getPreSessionData } from "../scheduling/repository";
import {
  startEncounterWorkflow,
  type AppointmentForEncounter,
  type EncounterRecord,
  type EncounterRepository,
} from "./workflow";

type DataRow = Row & { id: string };

function first<T>(rows: T[]) {
  return rows[0] ?? null;
}

const repository: EncounterRepository = {
  async getAppointment(id) {
    const row = first(await demoSelect<DataRow>("appointments", { id: `eq.${id}`, limit: "1" }));
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
      await demoSelect<EncounterRecord>("encounters", {
        appointment_id: `eq.${id}`,
        limit: "1",
      }),
    );
  },

  async getPreSessionContext(id) {
    const { appointment } = await getPreSessionData(id);
    return {
      readiness: appointment.readiness,
      policyId: appointment.policyId,
      payerId: appointment.payerId,
    };
  },

  createEncounter(values) {
    return demoInsert<EncounterRecord>("encounters", values);
  },

  updateAppointment(id, values) {
    return demoUpdate<DataRow>("appointments", id, values);
  },
};

export function startEncounter(appointmentId: string) {
  return startEncounterWorkflow(repository, appointmentId);
}

export async function getEncounterDetail(encounterId: string) {
  const encounter = first(
    await demoSelect<DataRow>("encounters", { id: `eq.${encounterId}`, limit: "1" }),
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
  ] = await Promise.all([
    demoSelect<DataRow>("clients", { id: `eq.${String(encounter.client_id)}`, limit: "1" }),
    encounter.provider_id
      ? demoSelect<DataRow>("providers", { id: `eq.${String(encounter.provider_id)}`, limit: "1" })
      : Promise.resolve([]),
    encounter.appointment_id
      ? demoSelect<DataRow>("appointments", { id: `eq.${String(encounter.appointment_id)}`, limit: "1" })
      : Promise.resolve([]),
    demoSelect<DataRow>("encounter_diagnoses", {
      encounter_id: `eq.${encounterId}`,
      order: "sequence_number.asc",
    }),
    demoSelect<DataRow>("encounter_service_lines", {
      encounter_id: `eq.${encounterId}`,
      order: "created_at.asc",
    }),
    demoSelect<DataRow>("encounter_readiness_checks", {
      encounter_id: `eq.${encounterId}`,
      order: "evaluated_at.desc",
    }),
    demoSelect<DataRow>("clinical_notes", {
      encounter_id: `eq.${encounterId}`,
      order: "created_at.desc",
    }),
    demoSelect<DataRow>("treatment_plans", {
      client_id: `eq.${String(encounter.client_id)}`,
      order: "effective_date.desc",
    }),
  ]);

  const policyRows = encounter.insurance_policy_id
    ? await demoSelect<DataRow>("client_insurance_policies", {
        id: `eq.${String(encounter.insurance_policy_id)}`,
        limit: "1",
      })
    : [];
  const policy = first(policyRows);

  const [payerRows, planRows, goalRows, signatures] = await Promise.all([
    encounter.payer_id
      ? referenceSelect<DataRow>("payers", { id: `eq.${String(encounter.payer_id)}`, limit: "1" })
      : Promise.resolve([]),
    policy?.payer_plan_id
      ? referenceSelect<DataRow>("payer_plans", { id: `eq.${String(policy.payer_plan_id)}`, limit: "1" })
      : Promise.resolve([]),
    treatmentPlans.length
      ? demoSelect<DataRow>("treatment_plan_goals", {
          treatment_plan_id: `in.(${treatmentPlans.map((row) => row.id).join(",")})`,
          order: "created_at.asc",
        })
      : Promise.resolve([]),
    notes.length
      ? demoSelect<DataRow>("clinical_note_signatures", {
          clinical_note_id: `in.(${notes.map((row) => row.id).join(",")})`,
          order: "signed_at.desc",
        })
      : Promise.resolve([]),
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
  };
}

export function updateEncounter(id: string, values: Row) {
  return demoUpdate<DataRow>("encounters", id, values);
}
