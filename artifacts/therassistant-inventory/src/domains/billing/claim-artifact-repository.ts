import { getCurrentTenantId, tenantRpc } from "../../lib/tenant-data-client";
import { storageClient } from "../../lib/storage-client";
import { build837PText } from "./claim-output";
import { getBatchExportData } from "./claim-output-repository";

type PreparedArtifact = {
  batch_id: string;
  generated_at: string;
  file_name: string;
  storage_path: string;
  archived: boolean;
  sha256?: string | null;
  byte_length?: number | null;
};

type FinalizedArtifact = {
  batch_id: string;
  generated_at: string;
  archived_at: string;
  file_name: string;
  storage_path: string;
  sha256: string;
  byte_length: number;
  transmission_ready: boolean;
};

function bytesOf(text: string) {
  return new TextEncoder().encode(text);
}

async function sha256Hex(text: string) {
  const bytes = bytesOf(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function archiveBatch837PArtifact(batchId: string) {
  const prepared = await tenantRpc<PreparedArtifact>("prepare_claim_edi_artifact", { p_batch_id: batchId });
  const output = await getBatchExportData(batchId);
  const generatedAt = new Date(prepared.generated_at);
  if (Number.isNaN(generatedAt.getTime())) throw new Error("The EDI generation timestamp is invalid.");

  const generatedText = build837PText(output, generatedAt);
  const generatedHash = await sha256Hex(generatedText);
  const generatedBytes = bytesOf(generatedText).byteLength;

  if (prepared.archived) {
    if (prepared.sha256 && prepared.sha256 !== generatedHash) throw new Error("The archived batch hash does not match the canonical 837P generated from the batch.");
    if (prepared.byte_length != null && Number(prepared.byte_length) !== generatedBytes) throw new Error("The archived batch length does not match the canonical 837P generated from the batch.");
  } else {
    const tenantId = await getCurrentTenantId();
    const upload = await storageClient.uploadClaimEdiArtifact({
      tenantId, batchId, fileName: prepared.file_name, text: generatedText,
    });
    if (upload.path !== prepared.storage_path) throw new Error("The archived EDI path does not match the reserved batch path.");
    await tenantRpc<FinalizedArtifact>("finalize_claim_edi_artifact", {
      p_batch_id: batchId, p_sha256: generatedHash, p_byte_length: generatedBytes,
    });
  }

  const archivedText = await storageClient.readClaimEdiArtifact(prepared.storage_path);
  const archivedHash = await sha256Hex(archivedText);
  if (archivedHash !== generatedHash) throw new Error("Archived 837P verification failed. The stored artifact differs from the canonical batch output.");

  return {
    batchId, text: archivedText, fileName: prepared.file_name, storagePath: prepared.storage_path,
    sha256: archivedHash, byteLength: bytesOf(archivedText).byteLength,
    generatedAt: prepared.generated_at, transmissionReady: true,
  };
}