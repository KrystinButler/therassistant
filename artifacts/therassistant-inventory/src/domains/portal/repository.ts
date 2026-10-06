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

type PortalContext = {
  tenant_id?: string | null;
  client_id?: string | null;
  status?: string | null;
};

type PortalBillingSummary = {
  open_balance_cents?: number | null;
  payments?: DataRow[] | null;
};

const PORTAL_DOCUMENT_BUCKET = "therassistant-documents";
const MAX_PORTAL_INSURANCE_BYTES = 50 * 1024 * 1024;
const PORTAL_INSURANCE_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
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


export async function uploadPortalInsuranceCard(file: File) {
  if (!file || !file.name.trim() || file.size <= 0) throw new Error("Choose a non-empty insurance card file.");
  if (file.size > MAX_PORTAL_INSURANCE_BYTES) throw new Error("The insurance card file exceeds the 50 MB limit.");
  const mimeType = file.type || "application/octet-stream";
  if (!PORTAL_INSURANCE_MIME_TYPES.has(mimeType)) {
    throw new Error("Insurance cards must be PDF, JPG, PNG, or WebP files.");
  }

  const context = await portalRpc<PortalContext | null>("get_my_client_portal_context");
  const tenantId = String(context?.tenant_id ?? "").trim();
  const clientId = String(context?.client_id ?? "").trim();
  if (context?.status !== "active" || !tenantId || !clientId) {
    throw new Error("Active patient portal access is required.");
  }

  const fileName = file.name.trim().replace(/[\\/]/g, "_");
  const storagePath = `${tenantId}/${clientId}/portal-insurance/${crypto.randomUUID()}/${fileName}`;
  const upload = await authenticatedFetch(
    `${SUPABASE_URL}/storage/v1/object/${PORTAL_DOCUMENT_BUCKET}/${encodeStoragePath(storagePath)}`,
    {
      method: "POST",
      headers: { "Content-Type": mimeType, "x-upsert": "false" },
      body: file,
    },
  );
  if (!upload.ok) {
    throw new Error(`Insurance card upload failed (${upload.status}): ${await upload.text()}`);
  }

  try {
    return await portalRpc<DataRow>("portal_register_insurance_card", {
      p_storage_path: storagePath,
      p_file_name: fileName,
      p_mime_type: mimeType,
      p_file_size_bytes: file.size,
    });
  } catch (error) {
    try {
      await authenticatedFetch(`${SUPABASE_URL}/storage/v1/object/${PORTAL_DOCUMENT_BUCKET}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: [storagePath] }),
      });
    } catch { /* Cleanup is best effort; the object remains unreadable without a linked document row. */ }
    throw error;
  }
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

export function submitPortalScheduleChange(
  appointmentId: string,
  requestType: "cancel" | "reschedule",
  details: string,
) {
  const clean = details.trim();
  if (!appointmentId) throw new Error("Appointment is required.");
  if (!clean) throw new Error("Add a note for the practice about this schedule change.");
  if (clean.length > 2000) throw new Error("Schedule change details must be 2,000 characters or fewer.");
  return portalRpc<DataValue>("portal_submit_schedule_change", {
    p_appointment_id: appointmentId,
    p_request_type: requestType,
    p_details: clean,
  });
}

export async function getPatientPortalData() {
  const [payload, provider, billing] = await Promise.all([
    portalRpc<PatientPortalAggregate>("get_my_patient_portal_data"),
    portalRpc<DataRow | null>("get_my_portal_provider_summary"),
    portalRpc<PortalBillingSummary>("get_my_portal_billing_summary"),
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
    openBalanceCents: Number(billing.open_balance_cents ?? portalData.openBalanceCents),
    patientPayments: billing.payments ?? [],
    treatmentGoals: payload.treatmentGoals,
    provider,
  };
}
