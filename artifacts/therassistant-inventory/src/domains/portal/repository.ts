import { authenticatedFetch, SUPABASE_URL } from "../../lib/supabase-client";
import {
  portalRpc,
  type PortalRow as DataValue,
} from "./portal-client";
import {
  buildJournalEntryValues,
  buildPatientPortalData,
  type CheckInStep,
  type JournalEntryInput,
  type PortalRow,
  type PreVisitCheckInUpdate,
} from "./workflow";

type DataRow = DataValue & { id: string };

type PortalDocumentAccess = DataRow & {
  storage_path: string;
  file_name?: string | null;
  mime_type?: string | null;
  file_size_bytes?: number | null;
};

const PORTAL_DOCUMENT_BUCKET = "therassistant-documents";
const encodeStoragePath = (value: string) => value.split("/").map(encodeURIComponent).join("/");

type PatientPortalAggregate = {
  patient: PortalRow | null;
  appointments: PortalRow[];
  insurancePolicies: PortalRow[];
  documents: PortalRow[];
  checkins: PortalRow[];
  journalEntries: PortalRow[];
  balance: PortalRow | null;
  treatmentGoals: DataRow[];
};

export function recordCheckIn(
  appointmentId: string,
  step: CheckInStep,
) {
  return portalRpc<string>("record_client_checkin", {
    p_appointment_id: appointmentId,
    p_status: step,
    p_responses: {},
  });
}

export function savePreVisitCheckIn(
  appointmentId: string,
  update: PreVisitCheckInUpdate,
) {
  return portalRpc<DataRow>("portal_save_previsit_checkin", {
    p_appointment_id: appointmentId,
    p_update: update,
  });
}

export function addPortalJournalEntry(input: JournalEntryInput) {
  const values = buildJournalEntryValues(input);
  return portalRpc<DataRow>("portal_add_journal_entry", {
    p_entry_text: values.entry_text,
    p_mood: values.mood,
    p_visibility: values.visibility,
    p_tags: values.tags,
    p_related_treatment_goal_id: values.related_treatment_goal_id,
    p_entry_status: values.entry_status,
  });
}

async function loadPortalDocument(documentId: string) {
  const access = await portalRpc<PortalDocumentAccess | null>("get_my_portal_document", {
    p_document_id: documentId,
  });
  if (!access) throw new Error("This document is unavailable in your portal.");

  const storagePath = String(access.storage_path ?? "").trim();
  if (!storagePath || storagePath.startsWith("synthetic-demo/metadata-only/")) {
    throw new Error("This document record does not have an uploaded file.");
  }

  const response = await authenticatedFetch(
    `${SUPABASE_URL}/storage/v1/object/authenticated/${PORTAL_DOCUMENT_BUCKET}/${encodeStoragePath(storagePath)}`,
  );
  if (!response.ok) {
    throw new Error(`Unable to open this portal document (${response.status}).`);
  }
  return { access, blob: await response.blob() };
}

export async function openPortalDocument(documentId: string) {
  const { blob } = await loadPortalDocument(documentId);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadPortalDocument(documentId: string) {
  const { access, blob } = await loadPortalDocument(documentId);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = String(access.file_name ?? "portal-document");
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function submitPortalChangeRequest(
  requestType: "demographics" | "insurance",
  details: string,
) {
  const clean = details.trim();
  if (!clean) throw new Error("Describe what needs to be updated.");
  if (clean.length > 2000) throw new Error("Change request details must be 2,000 characters or fewer.");
  return portalRpc<DataValue>("portal_submit_change_request", {
    p_request_type: requestType,
    p_details: clean,
  });
}

export async function getPatientPortalData() {
  const [payload, provider] = await Promise.all([
    portalRpc<PatientPortalAggregate>("get_my_patient_portal_data"),
    portalRpc<DataRow | null>("get_my_portal_provider_summary"),
  ]);

  if (!payload.patient) {
    throw new Error("Patient portal profile is unavailable.");
  }

  const portalData = buildPatientPortalData({
    patient: payload.patient,
    appointments: payload.appointments,
    policies: payload.insurancePolicies,
    documents: payload.documents,
    checkins: payload.checkins,
    journalEntries: payload.journalEntries,
    balance: payload.balance,
  });

  return {
    ...portalData,
    treatmentGoals: payload.treatmentGoals,
    provider,
  };
}
