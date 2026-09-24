import { getCurrentTenantId, referenceSelect, tenantSelect, type Row } from "../../lib/tenant-data-client";
import type { SuperbillData } from "./superbill";

type RecordRow = Row & { id: string };

export async function getPrivatePaySuperbillData(encounterId: string): Promise<SuperbillData> {
  if (!encounterId) throw new Error("Encounter is required.");
  const [encounters, charges] = await Promise.all([
    tenantSelect<RecordRow>("encounters", { id: "eq." + encounterId, limit: "1" }),
    tenantSelect<RecordRow>("charge_capture_items", { encounter_id: "eq." + encounterId, order: "service_date.asc,created_at.asc" }),
  ]);
  const encounter = encounters[0];
  if (!encounter) throw new Error("Encounter not found.");
  // Never put insurance or program-funded services on a private-pay superbill.
  const eligibleCharges = charges.filter((charge) =>
    charge.charge_status === "patient_responsibility" &&
    charge.billing_path === "private_pay" &&
    String(charge.client_id ?? "") === String(encounter.client_id ?? ""),
  );
  if (!eligibleCharges.length) throw new Error("No private-pay charges are available for this encounter.");

  const clientId = String(encounter.client_id ?? "");
  const providerId = String(encounter.provider_id ?? "");
  const tenantId = await getCurrentTenantId();
  const [clients, providers, diagnoses, entities, locations, tenants] = await Promise.all([
    tenantSelect<RecordRow>("clients", { id: "eq." + clientId, limit: "1" }),
    providerId ? tenantSelect<RecordRow>("providers", { id: "eq." + providerId, limit: "1" }) : Promise.resolve([]),
    tenantSelect<RecordRow>("encounter_diagnoses", { encounter_id: "eq." + encounterId, order: "sequence_number.asc" }),
    tenantSelect<RecordRow>("practice_entities", { status: "eq.active", order: "created_at.asc" }),
    tenantSelect<RecordRow>("practice_locations", { status: "eq.active", order: "is_primary.desc,created_at.asc" }),
    referenceSelect<RecordRow>("tenants", { id: "eq." + tenantId, limit: "1" }),
  ]);
  if (!clients[0]) throw new Error("The patient record for this encounter could not be retrieved.");
  const selectedEntity = entities.find((row) => row.id === String(encounter.practice_entity_id ?? "")) ?? entities[0] ?? null;
  const location = locations.find((row) => row.id === String(encounter.practice_location_id ?? "")) ??
    locations.find((row) => row.practice_entity_id === selectedEntity?.id) ?? null;
  return {
    encounter,
    client: clients[0],
    provider: providers[0] ?? null,
    practice: selectedEntity,
    location,
    tenant: tenants[0] ?? null,
    diagnoses,
    charges: eligibleCharges,
  };
}
