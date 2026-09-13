import { demoSelect, type Row } from "../../lib/supabase-demo-client";
import { buildClaim360Relationships } from "./relationships";

type DataRow = Row & { id: string };

function inFilter(ids: string[]) {
  return `in.(${ids.join(",")})`;
}

export async function getClaim360RelationshipsData(claimId: string) {
  const [batchItems, denials, directSubmissions] = await Promise.all([
    demoSelect<DataRow>("claim_batch_items", {
      claim_id: `eq.${claimId}`,
      order: "created_at.desc",
    }),
    demoSelect<DataRow>("denials", {
      claim_id: `eq.${claimId}`,
      order: "created_at.desc",
    }),
    demoSelect<DataRow>("claim_submissions", {
      claim_id: `eq.${claimId}`,
      order: "created_at.desc",
    }),
  ]);

  const batchIds = batchItems
    .map((row) => String(row.batch_id ?? ""))
    .filter(Boolean);
  const denialIds = denials.map((row) => row.id);

  const [batchSubmissions, claimWork, denialWork, batchWork] = await Promise.all([
    batchIds.length
      ? demoSelect<DataRow>("claim_submissions", {
          batch_id: inFilter(batchIds),
          order: "created_at.desc",
        })
      : Promise.resolve([]),
    demoSelect<DataRow>("workqueue_items", {
      source_object_type: "eq.claim",
      source_object_id: `eq.${claimId}`,
      order: "created_at.desc",
    }),
    denialIds.length
      ? demoSelect<DataRow>("workqueue_items", {
          source_object_type: "eq.denial",
          source_object_id: inFilter(denialIds),
          order: "created_at.desc",
        })
      : Promise.resolve([]),
    batchIds.length
      ? demoSelect<DataRow>("workqueue_items", {
          source_object_type: "eq.claim_batch",
          source_object_id: inFilter(batchIds),
          order: "created_at.desc",
        })
      : Promise.resolve([]),
  ]);

  const submissions = [
    ...new Map([...directSubmissions, ...batchSubmissions].map((row) => [row.id, row])).values(),
  ];
  const workItems = [
    ...new Map([...claimWork, ...denialWork, ...batchWork].map((row) => [row.id, row])).values(),
  ];

  return buildClaim360Relationships({
    claimId,
    batchItems,
    submissions,
    denials,
    workItems,
  });
}
