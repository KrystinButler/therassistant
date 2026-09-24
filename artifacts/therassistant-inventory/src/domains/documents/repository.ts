import { authenticatedFetch, SUPABASE_URL } from "../../lib/supabase-client";
import { getCurrentTenantId, tenantInsert, tenantSelect, type Row } from "../../lib/tenant-data-client";

type DataRow = Row & { id: string };
const BUCKET = "therassistant-documents";
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const safePath = (value: string) => value.split("/").map(encodeURIComponent).join("/");

export async function getPatientDocuments(patientId: string) {
  return tenantSelect<DataRow>("documents", {
    client_id: `eq.${patientId}`,
    order: "created_at.desc",
  });
}

export function isMetadataOnlyDocument(row: Record<string, unknown>) {
  return String(row.storage_path ?? "").startsWith("synthetic-demo/metadata-only/");
}

export async function uploadPatientDocument(patientId: string, file: File, documentType: string) {
  if (!file || !file.name.trim() || file.size === 0) throw new Error("Choose a non-empty file to upload.");
  if (file.size > MAX_FILE_BYTES) throw new Error("The file exceeds the 50 MB document limit.");
  const tenantId = await getCurrentTenantId();
  const fileName = file.name.trim().replace(/[\\/]/g, "_");
  const storagePath = `${tenantId}/${patientId}/${crypto.randomUUID()}/${fileName}`;
  const storageUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${safePath(storagePath)}`;
  const uploaded = await authenticatedFetch(storageUrl, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" },
    body: file,
  });
  if (!uploaded.ok) throw new Error(`Private document upload failed (${uploaded.status}): ${await uploaded.text()}`);
  try {
    return await tenantInsert<DataRow>("documents", {
      client_id: patientId,
      document_type: documentType || "other",
      document_status: "uploaded",
      file_name: fileName,
      storage_path: storagePath,
      mime_type: file.type || "application/octet-stream",
      file_size_bytes: file.size,
    });
  } catch (error) {
    // Never leave a downloadable object silently unlinked to the chart.
    try {
      await authenticatedFetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: [storagePath] }),
      });
    } catch { /* Report the indexing failure; cleanup is best effort. */ }
    throw error;
  }
}

export async function downloadPatientDocument(record: Record<string, unknown>) {
  if (isMetadataOnlyDocument(record)) throw new Error("This legacy record has no uploaded file.");
  const storagePath = String(record.storage_path ?? "");
  if (!storagePath) throw new Error("The document has no storage path.");
  const result = await authenticatedFetch(
    `${SUPABASE_URL}/storage/v1/object/authenticated/${BUCKET}/${safePath(storagePath)}`,
  );
  if (!result.ok) throw new Error(`Document download failed (${result.status}). Check your chart access.`);
  const blob = await result.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = String(record.file_name ?? "patient-document");
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

// Retained only for historical metadata-only demo records and existing test fixtures.
export function addSyntheticDocumentMetadata(patientId: string, input: { fileName: string; documentType: string; mimeType?: string; fileSizeBytes?: number }) {
  const fileName = input.fileName.trim();
  if (!fileName) throw new Error("File name is required.");
  return tenantInsert<DataRow>("documents", {
    client_id: patientId,
    document_type: input.documentType || "other",
    document_status: "uploaded",
    file_name: fileName,
    storage_path: `synthetic-demo/metadata-only/${patientId}/${encodeURIComponent(fileName)}`,
    mime_type: input.mimeType?.trim() || null,
    file_size_bytes: input.fileSizeBytes ?? null,
  });
}
