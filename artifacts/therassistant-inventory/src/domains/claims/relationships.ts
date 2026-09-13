type Row = Record<string, any> & { id: string };

export function buildClaim360Relationships(input: {
  claimId: string;
  batchItems: Row[];
  submissions: Row[];
  denials: Row[];
  workItems: Row[];
}) {
  const batchIds = new Set(
    input.batchItems
      .filter((row) => row.claim_id === input.claimId)
      .map((row) => String(row.batch_id ?? ""))
      .filter(Boolean),
  );
  const denialIds = new Set(
    input.denials
      .filter((row) => row.claim_id === input.claimId)
      .map((row) => row.id),
  );

  const submissions = input.submissions.filter((row) =>
    row.claim_id === input.claimId ||
    (row.batch_id && batchIds.has(String(row.batch_id))),
  );

  const workItems = input.workItems.filter((row) => {
    const sourceType = String(row.source_object_type ?? "");
    const sourceId = String(row.source_object_id ?? "");
    if (sourceType === "claim" && sourceId === input.claimId) return true;
    if (sourceType === "denial" && denialIds.has(sourceId)) return true;
    if (sourceType === "claim_batch" && batchIds.has(sourceId)) return true;
    return false;
  });

  return { submissions, workItems, batchIds: [...batchIds], denialIds: [...denialIds] };
}
