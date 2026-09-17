import { tenantSelect, referenceSelect, type Row } from "../../lib/tenant-data-client";
import { buildAuthorizationQueue, buildEligibilityQueue } from "./queues";

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

export async function getAuthorizationQueueData() {
  const [clients, payers, policies, authorizations, units] = await Promise.all([
    tenantSelect<DataRow>("clients", { order: "last_name.asc,first_name.asc" }),
    referenceSelect<DataRow>("payers", { order: "name.asc" }),
    tenantSelect<DataRow>("client_insurance_policies", { order: "created_at.asc" }),
    tenantSelect<DataRow>("authorizations", { order: "created_at.desc" }),
    tenantSelect<DataRow>("authorization_units", { order: "created_at.asc" }),
  ]);

  return buildAuthorizationQueue({ clients, payers, policies, authorizations, units });
}
