import {
  tenantInsert,
  tenantSelect,
  tenantUpdate,
  type Row,
} from "../../lib/tenant-data-client";
import { routeEncounterToBilling } from "../billing/repository";
import { updateEncounter } from "../encounters/repository";
import { signNoteWorkflow, type ClinicalSigningRepository } from "./workflow";

type DataRow = Row & { id: string };

function first<T>(rows: T[]) {
  return rows[0] ?? null;
}

async function clinicalState(encounterId: string) {
  const [encounters, notes, diagnoses, serviceLines] = await Promise.all([
    tenantSelect<DataRow>("encounters", { id: `eq.${encounterId}`, limit: "1" }),
    tenantSelect<DataRow>("clinical_notes", {
      encounter_id: `eq.${encounterId}`,
      order: "created_at.desc",
      limit: "1",
    }),
    tenantSelect<DataRow>("encounter_diagnoses", {
      encounter_id: `eq.${encounterId}`,
      order: "sequence_number.asc",
    }),
    tenantSelect<DataRow>("encounter_service_lines", {
      encounter_id: `eq.${encounterId}`,
      order: "created_at.asc",
    }),
  ]);

  return {
    encounter: first(encounters),
    note: first(notes),
    diagnoses,
    serviceLines,
  };
}

const signingRepository: ClinicalSigningRepository = {
  getClinicalState: clinicalState,
  createSignature(values) {
    return tenantInsert<DataRow>("clinical_note_signatures", values);
  },
  updateNote(id, values) {
    return tenantUpdate<DataRow>("clinical_notes", id, values);
  },
  async runBillingReadiness(encounterId) {
    const state = await clinicalState(encounterId);
    if (!state.encounter) throw new Error("Encounter not found.");

    const completedAt = new Date().toISOString();
    await updateEncounter(encounterId, {
      encounter_status: "completed",
      ended_at: state.encounter.ended_at || completedAt,
    });

    if (state.encounter.appointment_id) {
      await tenantUpdate<DataRow>("appointments", String(state.encounter.appointment_id), {
        appointment_status: "completed",
        completed_at: completedAt,
      });
    }

    const readiness = await routeEncounterToBilling(encounterId);
    if (!readiness.ok && !readiness.blocked) {
      throw new Error(readiness.message);
    }
    return readiness;
  },
};

export async function saveClinicalNote(
  encounterId: string,
  values: {
    noteType?: string;
    noteText: string;
    goalAddressed?: string;
  },
) {
  const state = await clinicalState(encounterId);
  if (!state.encounter) throw new Error("Encounter not found.");

  if (state.note) {
    const status = String(state.note.note_status ?? "draft");
    if (["signed", "locked", "voided"].includes(status)) {
      throw new Error("Signed or locked documentation cannot be edited. Amend the note instead.");
    }
    return tenantUpdate<DataRow>("clinical_notes", state.note.id, {
      note_type: values.noteType || state.note.note_type || "psychotherapy",
      note_status: "ready_for_signature",
      note_text: values.noteText,
      goal_addressed: values.goalAddressed || null,
    });
  }

  const serviceDate = String(state.encounter.started_at ?? new Date().toISOString()).slice(0, 10);
  return tenantInsert<DataRow>("clinical_notes", {
    encounter_id: encounterId,
    client_id: state.encounter.client_id,
    appointment_id: state.encounter.appointment_id || null,
    provider_id: state.encounter.provider_id || null,
    note_type: values.noteType || "psychotherapy",
    note_status: "ready_for_signature",
    service_date: serviceDate,
    note_text: values.noteText,
    goal_addressed: values.goalAddressed || null,
  });
}

export async function addEncounterDiagnosis(
  encounterId: string,
  values: {
    diagnosisCode: string;
    diagnosisDescription?: string;
    isPrimary?: boolean;
  },
) {
  if (!values.diagnosisCode.trim()) throw new Error("Diagnosis code is required.");
  const existing = await tenantSelect<DataRow>("encounter_diagnoses", {
    encounter_id: `eq.${encounterId}`,
    order: "sequence_number.asc",
  });

  return tenantInsert<DataRow>("encounter_diagnoses", {
    encounter_id: encounterId,
    diagnosis_code: values.diagnosisCode.trim().toUpperCase(),
    diagnosis_description: values.diagnosisDescription?.trim() || null,
    is_primary: values.isPrimary ?? existing.length === 0,
    sequence_number: existing.length + 1,
    present_on_claim: true,
  });
}

export async function addEncounterServiceLine(
  encounterId: string,
  values: {
    cptCode: string;
    modifier1?: string;
    modifier2?: string;
    units: number;
    chargeAmountCents: number;
    placeOfService: string;
  },
) {
  if (!values.cptCode.trim()) throw new Error("CPT/HCPCS code is required.");
  if (values.units <= 0) throw new Error("Units must be greater than zero.");
  if (values.chargeAmountCents < 0) throw new Error("Charge amount cannot be negative.");

  return tenantInsert<DataRow>("encounter_service_lines", {
    encounter_id: encounterId,
    cpt_hcpcs_code: values.cptCode.trim().toUpperCase(),
    modifier1: values.modifier1?.trim().toUpperCase() || null,
    modifier2: values.modifier2?.trim().toUpperCase() || null,
    units: values.units,
    charge_amount_cents: values.chargeAmountCents,
    place_of_service_code: values.placeOfService || null,
    ready_for_claim: false,
  });
}

export async function signEncounterNote(
  encounterId: string,
  signerId: string,
  signatureText: string,
) {
  return signNoteWorkflow(signingRepository, encounterId, signerId, signatureText);
}
