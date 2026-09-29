import { tenantSelect, referenceSelect, type Row } from "../../lib/tenant-data-client";
import { buildEligibilityQueue } from "./queues";

type DataRow = Row & { id: string };

export async function getEligibilityQueueData() {
  const [clients, payers, policies, eligibility] = await Promise.all([
    tenantSelect<DataRow>("clients", { order: "last_name.asc,first_name.asc" }),
    referenceSelect<DataRow>("payers", { order: "name.asc" }),
    tenantSelect<DataRow>("client_insurance_policies", { order: "created_at.asc" }),
    tenantSelect<DataRow>("eligibility_checks", { order: "created_at.desc" }),
  ]);

  return buildEligibilityQueue({ clients, payers, policies, eligibility });
}
