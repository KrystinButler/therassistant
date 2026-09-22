import { tenantSelect, type Row } from "../../lib/tenant-data-client";

type DataRow = Row & { id: string };

export type PatientCreationPrerequisites = {
  activeEntity: DataRow | null;
  activeProvider: DataRow | null;
  activeLocation: DataRow | null;
  ready: boolean;
  missing: Array<"entity" | "provider" | "location">;
};

function first<T>(rows: T[]) {
  return rows[0] ?? null;
}

export async function getPatientCreationPrerequisites(): Promise<PatientCreationPrerequisites> {
  const [entities, providers, locations] = await Promise.all([
    tenantSelect<DataRow>("practice_entities", {
      status: "eq.active",
      order: "created_at.asc",
    }),
    tenantSelect<DataRow>("providers", {
      provider_status: "eq.active",
      order: "created_at.asc",
    }),
    tenantSelect<DataRow>("practice_locations", {
      status: "eq.active",
      order: "is_primary.desc,created_at.asc",
    }),
  ]);

  const activeEntity = first(entities);
  const activeProvider = first(providers);
  const activeLocation = locations.find((location) =>
    entities.some((entity) => entity.id === String(location.practice_entity_id ?? ""))
  ) ?? null;

  const missing: PatientCreationPrerequisites["missing"] = [];
  if (!activeEntity) missing.push("entity");
  if (!activeProvider) missing.push("provider");
  if (!activeLocation) missing.push("location");

  return {
    activeEntity,
    activeProvider,
    activeLocation,
    ready: missing.length === 0,
    missing,
  };
}
