import {
  tenantInsert,
  tenantSelect,
  tenantUpdate,
  tenantDelete,
  tenantRpc,
  type Row,
} from "../../lib/tenant-data-client";
import { createChargeFromEncounter } from "../billing/repository";
import { matchingServiceLineExists, validateServiceLineValues, type ServiceLineValues } from "../encounters/service-line-validation";
import { saveStructuredClinicalData } from "./fast-charting-repository";
import type { StructuredSelections } from "./fast-charting";
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

    const readiness = await createChargeFromEncounter(encounterId);
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
    structuredSelections?: StructuredSelections;
    generatedNarrative?: string;
    carryForwardContext?: Row;
  },
) {
  const state = await clinicalState(encounterId);
  if (!state.encounter) throw new Error("Encounter not found.");

  let saved: DataRow;
  if (state.note) {
    const status = String(state.note.note_status ?? "draft");
    if (["signed", "locked", "voided"].includes(status)) {
      throw new Error("Signed or locked documentation cannot be edited. Amend the note instead.");
    }
    saved = await tenantUpdate<DataRow>("clinical_notes", state.note.id, {
      note_type: values.noteType || state.note.note_type || "psychotherapy",
      note_status: "ready_for_signature",
      note_text: values.noteText,
      goal_addressed: values.goalAddressed || null,
    });
  } else {
    const serviceDate = String(state.encounter.started_at ?? new Date().toISOString()).slice(0, 10);
    saved = await tenantInsert<DataRow>("clinical_notes", {
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

  if (values.structuredSelections) {
    await saveStructuredClinicalData(saved, {
      selections: values.structuredSelections,
      generatedNarrative: values.generatedNarrative || "",
      carryForwardContext: values.carryForwardContext || {},
    });
  }
  return saved;
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

async function assertUnbilledLine(encounterId: string, lineId: string, allowBlockedCorrection = false): Promise<DataRow> {
  const [encounters, lines, charges, claims] = await Promise.all([
    tenantSelect<DataRow>("encounters", { id: `eq.${encounterId}`, limit: "1" }),
    tenantSelect<DataRow>("encounter_service_lines", { id: `eq.${lineId}`, encounter_id: `eq.${encounterId}`, limit: "1" }),
    tenantSelect<DataRow>("charge_capture_items", { service_line_id: `eq.${lineId}` }),
    tenantSelect<DataRow>("professional_claims", { source_encounter_id: `eq.${encounterId}`, limit: "1" }),
  ]);
  if (!encounters.length || !lines.length) throw new Error("Service line not found in this practice's encounter.");
  if (claims.length) throw new Error("This encounter has an existing claim. Correct it in Rejections or Claims instead.");
  if (charges.some((charge) => charge.charge_status !== "voided" && !(allowBlockedCorrection && ["blocked", "ready_for_claim"].includes(String(charge.charge_status)))))
    throw new Error("This service line has a downstream charge that cannot be edited here. Open the revenue-cycle workqueue.");
  return lines[0];
}
export async function addEncounterServiceLine(encounterId: string, values: ServiceLineValues) {
  validateServiceLineValues(values);
  const [encounters, existing] = await Promise.all([
    tenantSelect<DataRow>("encounters", { id: `eq.${encounterId}`, limit: "1" }),
    tenantSelect<DataRow>("encounter_service_lines", { encounter_id: `eq.${encounterId}` }),
  ]);
  if (!encounters.length) throw new Error("Encounter not found in this practice.");
  if (matchingServiceLineExists(existing, values))
    throw new Error("Matching service line already exists. Edit the existing entry to prevent duplicate charges.");
  return tenantInsert<DataRow>("encounter_service_lines", {
    encounter_id: encounterId, cpt_hcpcs_code: values.cptCode, modifier1: values.modifier1 || null,
    units: values.units, charge_amount_cents: values.chargeAmountCents, place_of_service_code: values.placeOfService, ready_for_claim: false,
  });
}
export async function updateEncounterServiceLine(encounterId: string, lineId: string, values: ServiceLineValues) {
  validateServiceLineValues(values);
  await assertUnbilledLine(encounterId, lineId, true);
  return tenantUpdate<DataRow>("encounter_service_lines", lineId, {
    cpt_hcpcs_code: values.cptCode, modifier1: values.modifier1 || null,
    units: values.units, charge_amount_cents: values.chargeAmountCents, place_of_service_code: values.placeOfService, ready_for_claim: false,
  });
}
export async function removeEncounterServiceLine(encounterId: string, lineId: string): Promise<void> {
  await assertUnbilledLine(encounterId, lineId);
  await tenantDelete("encounter_service_lines", lineId);
}

/** Atomically voids unclaimed charges and removes their source line under tenant/claim guards. */
export function voidPreclaimServiceLine(encounterId: string, lineId: string) {
  return tenantRpc<{ voided: boolean; encounter_id: string; service_line_id: string }>(
    "void_unclaimed_service_line",
    { p_encounter_id: encounterId, p_service_line_id: lineId },
  );
}

export async function signEncounterNote(
  encounterId: string,
  signerId: string,
  signatureText: string,
) {
  return signNoteWorkflow(signingRepository, encounterId, signerId, signatureText);
}
