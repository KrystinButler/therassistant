import {
  demoSelect,
  referenceSelect,
  type Row,
} from "../../lib/supabase-demo-client";
import { buildClientChartRelationships } from "./chart";

type DataRow = Row & { id: string };

export async function getClientChartRelationships(clientId: string) {
  const [encounters, appointments, providers, payers, charges, claims, workItems] =
    await Promise.all([
      demoSelect<DataRow>("encounters", { order: "started_at.desc" }),
      demoSelect<DataRow>("appointments", { order: "starts_at.desc" }),
      demoSelect<DataRow>("providers"),
      referenceSelect<DataRow>("payers", { order: "name.asc" }),
      demoSelect<DataRow>("charge_capture_items", { order: "created_at.desc" }),
      demoSelect<DataRow>("professional_claims", { order: "created_at.desc" }),
      demoSelect<DataRow>("workqueue_items", { order: "created_at.desc" }),
    ]);

  return buildClientChartRelationships({
    clientId,
    encounters,
    appointments,
    providers,
    payers,
    charges,
    claims,
    workItems,
  });
}
