import { referenceSelect, type Row } from "../../lib/supabase-demo-client";

type DataRow = Row & { id: string };

export async function getInsuranceOptions() {
  const [payers, plans] = await Promise.all([
    referenceSelect<DataRow>("payers", { order: "name.asc" }),
    referenceSelect<DataRow>("payer_plans", { order: "name.asc" }),
  ]);
  return { payers, plans };
}
