import { demoInsert, demoSelect, type Row } from "../../lib/supabase-demo-client";

type DataRow = Row & { id: string };

export async function getPatientDocuments(patientId: string) {
  return demoSelect<DataRow>("documents", {
    client_id: `eq.${patientId}`,
    order: "created_at.desc",
  });
}

export function addSyntheticDocumentMetadata(
  patientId: string,
  input: {
    fileName: string;
    documentType: string;
    mimeType?: string;
    fileSizeBytes?: number;
  },
) {
  const fileName = input.fileName.trim();
  if (!fileName) throw new Error("File name is required.");
  return demoInsert<DataRow>("documents", {
    client_id: patientId,
    document_type: input.documentType || "other",
    document_status: "uploaded",
    file_name: fileName,
    storage_path: `synthetic-demo/metadata-only/${patientId}/${encodeURIComponent(fileName)}`,
    mime_type: input.mimeType?.trim() || null,
    file_size_bytes: input.fileSizeBytes ?? null,
  });
}
