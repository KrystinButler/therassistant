import { tenantSelect, type Row } from "../../lib/tenant-data-client";
import { getClaimSubmissionData } from "../claims/repository";
import type { BatchOutputData, ClaimOutputItem } from "./claim-output";

type DataRow = Row & { id: string };

function inFilter(ids: string[]) {
  return `in.(${ids.join(",")})`;
}

export async function getBatchExportData(batchId: string): Promise<BatchOutputData> {
  const data = await getClaimSubmissionData();
  const batch = data.batches.find((row) => row.id === batchId);
  if (!batch) throw new Error("Claim batch not found.");

  const claimIds = batch.claimIds.filter(Boolean);
  if (!claimIds.length) return { batch, claims: [] };

  const [lines, diagnoses] = await Promise.all([
    tenantSelect<DataRow>("professional_claim_lines", {
      claim_id: inFilter(claimIds),
      order: "service_date.asc,created_at.asc",
    }),
    tenantSelect<DataRow>("claim_diagnoses", {
      claim_id: inFilter(claimIds),
      order: "pointer_order.asc",
    }),
  ]);

  const claims: ClaimOutputItem[] = claimIds.map((claimId) => {
    const claim = data.claims.find((row) => row.id === claimId);
    if (!claim) throw new Error(`Claim ${claimId} was not found in the batch.`);
    return {
      claim,
      lines: lines.filter((row) => String(row.claim_id ?? "") === claimId),
      diagnoses: diagnoses.filter((row) => String(row.claim_id ?? "") === claimId),
    };
  });

  return { batch, claims };
}
