import { demoSelect, referenceSelect, type Row } from "../../lib/supabase-demo-client";
import { buildAuthorizationQueue, buildEligibilityQueue } from "./queues";

type DataRow = Row & { id: string };

export async function getEligibilityQueueData() {
  const [clients, payers, policies, eligibility] = await Promise.all([
    demoSelect<DataRow>("clients", { order: "last_name.asc,first_name.asc" }),
    referenceSelect<DataRow>("payers", { order: "name.asc" }),
    demoSelect<DataRow>("client_insurance_policies", { order: "created_at.asc" }),
    demoSelect<DataRow>("eligibility_checks", { order: "created_at.desc" }),
  ]);

  return buildEligibilityQueue({ clients, payers, policies, eligibility });
}

export async function getAuthorizationQueueData() {
  const [clients, payers, policies, authorizations, units] = await Promise.all([
    demoSelect<DataRow>("clients", { order: "last_name.asc,first_name.asc" }),
    referenceSelect<DataRow>("payers", { order: "name.asc" }),
    demoSelect<DataRow>("client_insurance_policies", { order: "created_at.asc" }),
    demoSelect<DataRow>("authorizations", { order: "created_at.desc" }),
    demoSelect<DataRow>("authorization_units", { order: "created_at.asc" }),
  ]);

  return buildAuthorizationQueue({ clients, payers, policies, authorizations, units });
}
