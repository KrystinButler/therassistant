import { normalizePractitionerRole } from "./normalizer.ts";
import { taxonomyCodes, taxonomyVersion } from "./taxonomy.ts";
export class ImportError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
type Dependencies = {
  authorize: (tenant: string) => Promise<boolean>;
  findProviders: (tenant: string, npi: string) => Promise<{ id: string }[]>;
  save: (row: Record<string, unknown>) => Promise<unknown>;
};
export async function importRole(input: unknown, deps: Dependencies) {
  const b = input as Record<string, unknown> | null;
  if (
    !b ||
    typeof b.tenant_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      b.tenant_id,
    )
  )
    throw new ImportError(400, "Select a valid practice.");
  if (!(await deps.authorize(b.tenant_id)))
    throw new ImportError(
      403,
      "You do not have permission to import into this practice.",
    );
  if (typeof b.source !== "string" || !b.source.trim() || b.source.length > 120)
    throw new ImportError(
      422,
      "Enter a directory source name (maximum 120 characters).",
    );
  const resource = b.resource as Record<string, unknown> | null;
  if (
    !resource ||
    typeof resource.id !== "string" ||
    !/^[A-Za-z0-9.-]{1,64}$/.test(resource.id)
  )
    throw new ImportError(
      422,
      "PractitionerRole.id is required for duplicate protection.",
    );
  const normalized = await normalizePractitionerRole(resource, {
    taxonomyVersion,
    taxonomyExists: (code) => taxonomyCodes.has(code),
  });
  const providers = await deps.findProviders(b.tenant_id, normalized.npi);
  if (providers.length !== 1)
    throw new ImportError(
      422,
      "NPI must match exactly one existing provider in this practice.",
    );
  if (b.preview === true) return { preview: true, normalized };
  await deps.save({
    tenant_id: b.tenant_id,
    provider_id: providers[0].id,
    source: b.source.trim(),
    external_id: resource.id,
    normalized,
    raw_resource: resource,
    updated_at: new Date().toISOString(),
  });
  return { preview: false, normalized };
}
