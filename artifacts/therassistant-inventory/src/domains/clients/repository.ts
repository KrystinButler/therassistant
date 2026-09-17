import {
  tenantSelect,
  referenceSelect,
  type Row,
} from "../../lib/tenant-data-client";
import { buildClientChartRelationships } from "./chart";

type DataRow = Row & { id: string };

export async function getClientChartRelationships(clientId: string) {
  const [encounters, appointments, providers, payers, charges, claims, workItems] =
    await Promise.all([
      tenantSelect<DataRow>("encounters", { order: "started_at.desc" }),
      tenantSelect<DataRow>("appointments", { order: "starts_at.desc" }),
      tenantSelect<DataRow>("providers"),
      referenceSelect<DataRow>("payers", { order: "name.asc" }),
      tenantSelect<DataRow>("charge_capture_items", { order: "created_at.desc" }),
      tenantSelect<DataRow>("professional_claims", { order: "created_at.desc" }),
      tenantSelect<DataRow>("workqueue_items", { order: "created_at.desc" }),
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
