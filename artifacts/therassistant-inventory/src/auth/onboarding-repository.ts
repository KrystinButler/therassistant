import { authenticatedFetch, SUPABASE_URL } from "../lib/supabase-client";
import {
  getCurrentTenantId,
  referenceSelect,
  tenantInsert,
  tenantSelect,
  tenantUpdate,
  tenantRpc,
  type Row,
} from "../lib/tenant-data-client";

type DataRow = Row & { id: string };

export type ProviderOnboardingDraft = {
  fullName: string;
  caqhId: string;
  npi: string;
  licenseNumber: string;
  dob: string;
  ssn: string;
  taxonomyCode: string;
  medicaidId: string;
  ptan: string;
  supervisor: string;
  delegates: string;
  files?: Record<string, File | null>;
};

export type PracticeOnboardingDraft = {
  practiceName: string;
  primaryLocation: string;
  npi2: string;
  tin: string;
  additionalLocations: string[];
};

export type SelfPayRate = { cpt: string; amount: string };

const BUCKET = "therassistant-documents";
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const safePath = (value: string) => value.split("/").map(encodeURIComponent).join("/");

export const NETWORK_PAYER_NAMES: Record<string, string[]> = {
  aetna: ["Aetna"],
  bcbs: ["Anthem Blue Cross Blue Shield"],
  cigna: ["Cigna"],
  colorado_access: ["Colorado Access"],
  ccha: ["Colorado Community Health Alliance"],
  medicare: ["Medicare"],
  rmhp: ["Rocky Mountain HMO"],
  uhc: ["UnitedHealthcare"],
  tricare: ["TriCare for Life", "Tricare West", "TriWest Healthcare Alliance"],
};

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { firstName: parts[0] ?? "", lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) ?? "" };
}

export async function getOnboardingRecord() {
  const rows = await tenantSelect<DataRow>("tenant_onboarding", { limit: "1" });
  return rows[0] ?? null;
}

export async function saveOnboardingProgress(
  currentStep: number,
  patch: Record<string, unknown>,
) {
  const row = await getOnboardingRecord();
  if (!row) throw new Error("Onboarding record is unavailable.");
  const currentData = row.data && typeof row.data === "object" && !Array.isArray(row.data)
    ? row.data as Record<string, unknown>
    : {};
  return tenantUpdate<DataRow>("tenant_onboarding", row.id, {
    current_step: Math.max(1, Math.min(14, currentStep)),
    data: { ...currentData, ...patch },
  });
}

export async function completeOnboarding() {
  const row = await getOnboardingRecord();
  if (!row) throw new Error("Onboarding record is unavailable.");
  return tenantUpdate<DataRow>("tenant_onboarding", row.id, {
    current_step: 14,
    status: "completed",
    completed_at: new Date().toISOString(),
  });
}

export async function createProviderFromOnboarding(draft: ProviderOnboardingDraft) {
  const { firstName, lastName } = splitName(draft.fullName);
  if (!firstName || !lastName) throw new Error("Enter the provider's full legal name.");
  if (!/^\d{10}$/.test(draft.npi.trim())) throw new Error("Provider NPI must contain exactly 10 digits.");

  const provider = await tenantInsert<DataRow>("providers", {
    first_name: firstName,
    last_name: lastName,
    provider_status: "active",
    individual_npi: draft.npi.trim(),
    taxonomy_code: draft.taxonomyCode.trim().toUpperCase() || null,
    date_of_birth: draft.dob || null,
    caqh_id: draft.caqhId.trim() || null,
  });

  if (draft.licenseNumber.trim()) {
    await tenantInsert<DataRow>("provider_credentials", {
      provider_id: provider.id,
      credential_type: "professional_license",
      credential_name: "Professional License",
      credential_number: draft.licenseNumber.trim(),
      status: "pending",
      verification_source: "provider_onboarding",
    });
  }

  for (const [type, value] of [
    ["MEDICAID_ID", draft.medicaidId],
    ["PTAN", draft.ptan],
  ] as const) {
    if (!value.trim()) continue;
    await tenantInsert<DataRow>("provider_identifiers", {
      provider_id: provider.id,
      identifier_type: type,
      identifier_value: value.trim(),
    });
  }

  if (draft.ssn.trim()) {
    const tenantId = await getCurrentTenantId();
    await tenantRpc("store_provider_ssn", {
      p_tenant_id: tenantId,
      p_provider_id: provider.id,
      p_ssn: draft.ssn,
    });
  }

  return provider;
}

export async function createPracticeFromOnboarding(draft: PracticeOnboardingDraft) {
  const entity = await tenantInsert<DataRow>("practice_entities", {
    legal_name: draft.practiceName.trim(),
    group_npi: draft.npi2.replace(/\D/g, "") || null,
    tax_id: draft.tin.replace(/\D/g, "") || null,
    status: "active",
  });

  const primary = await tenantInsert<DataRow>("practice_locations", {
    practice_entity_id: entity.id,
    name: `${draft.practiceName.trim()} Primary Location`,
    location_type: "office",
    address_line1: draft.primaryLocation.trim() || null,
    location_npi: draft.npi2.replace(/\D/g, "") || null,
    is_primary: true,
    status: "active",
  });

  const locations = [primary];
  for (const [index, location] of draft.additionalLocations.entries()) {
    if (!location.trim()) continue;
    locations.push(await tenantInsert<DataRow>("practice_locations", {
      practice_entity_id: entity.id,
      name: `${draft.practiceName.trim()} Location ${index + 2}`,
      location_type: "office",
      address_line1: location.trim(),
      is_primary: false,
      status: "active",
    }));
  }
  return { entity, locations };
}

export async function uploadOnboardingDocument(input: {
  file: File;
  category: string;
  providerId?: string | null;
  practiceEntityId?: string | null;
}) {
  const { file } = input;
  if (!file?.name.trim() || file.size === 0) throw new Error("Choose a non-empty file.");
  if (file.size > MAX_FILE_BYTES) throw new Error("The file exceeds the 50 MB document limit.");

  const tenantId = await getCurrentTenantId();
  const fileName = file.name.trim().replace(/[\\/]/g, "_");
  const storagePath = `${tenantId}/onboarding/${input.providerId || input.practiceEntityId || "organization"}/${crypto.randomUUID()}/${fileName}`;
  const upload = await authenticatedFetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${safePath(storagePath)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "x-upsert": "false",
      },
      body: file,
    },
  );
  if (!upload.ok) throw new Error(`Document upload failed (${upload.status}): ${await upload.text()}`);

  try {
    return await tenantInsert<DataRow>("documents", {
      provider_id: input.providerId ?? null,
      practice_entity_id: input.practiceEntityId ?? null,
      document_type: "other",
      document_status: "uploaded",
      file_name: fileName,
      storage_path: storagePath,
      mime_type: file.type || "application/octet-stream",
      file_size_bytes: file.size,
      metadata: { onboarding_category: input.category },
    });
  } catch (error) {
    try {
      await authenticatedFetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: [storagePath] }),
      });
    } catch {
      // Best-effort cleanup only; surface the indexing error below.
    }
    throw error;
  }
}

export async function configureSelectedNetworks(
  networkKeys: string[],
  practiceEntityId: string,
) {
  const payerRows = await referenceSelect<DataRow>("payers", { order: "name.asc" });
  const names = new Set(networkKeys.flatMap((key) => NETWORK_PAYER_NAMES[key] ?? []));
  const selected = payerRows.filter((payer) => names.has(String(payer.name ?? "")));

  for (const payer of selected) {
    const existing = await tenantSelect<DataRow>("payer_contracts", {
      payer_id: `eq.${payer.id}`,
      practice_entity_id: `eq.${practiceEntityId}`,
      order: "created_at.asc",
      limit: "1",
    });
    const contract = existing[0] ?? await tenantInsert<DataRow>("payer_contracts", {
      payer_id: payer.id,
      practice_entity_id: practiceEntityId,
      contract_name: `${String(payer.name)} Network Setup`,
      status: "draft",
      notes: "Selected as in-network during onboarding. Verify effective date and participation evidence before production billing.",
    });

    const schedule = await tenantSelect<DataRow>("fee_schedules", {
      payer_contract_id: `eq.${contract.id}`,
      limit: "1",
    });
    if (!schedule[0]) {
      await tenantInsert<DataRow>("fee_schedules", {
        payer_contract_id: contract.id,
        name: `${String(payer.name)} Fee Schedule`,
        status: "draft",
      });
    }
  }
  return selected.map((payer) => ({
    id: payer.id,
    name: String(payer.name ?? ""),
    payerId: String(payer.clearinghouse_payer_id ?? ""),
  }));
}

export async function saveSelfPayRates(rates: SelfPayRate[]) {
  const valid = rates
    .map((rate) => ({
      cpt: rate.cpt.trim().toUpperCase(),
      cents: Math.round(Number(rate.amount) * 100),
    }))
    .filter((rate) => /^[A-Z0-9]{4,5}$/.test(rate.cpt) && Number.isFinite(rate.cents) && rate.cents > 0);
  if (!valid.length) return null;

  const existing = await tenantSelect<DataRow>("fee_schedules", {
    payer_contract_id: "is.null",
    name: "eq.Self-Pay / Standard Charges",
    limit: "1",
  });
  const schedule = existing[0]
    ? await tenantUpdate<DataRow>("fee_schedules", existing[0].id, { status: "active" })
    : await tenantInsert<DataRow>("fee_schedules", {
        payer_contract_id: null,
        name: "Self-Pay / Standard Charges",
        status: "active",
        effective_date: new Date().toISOString().slice(0, 10),
      });

  for (const rate of valid) {
    const rows = await tenantSelect<DataRow>("fee_schedule_lines", {
      fee_schedule_id: `eq.${schedule.id}`,
      cpt_code: `eq.${rate.cpt}`,
      limit: "1",
    });
    if (rows[0]) {
      await tenantUpdate<DataRow>("fee_schedule_lines", rows[0].id, { rate_cents: rate.cents });
    } else {
      await tenantInsert<DataRow>("fee_schedule_lines", {
        fee_schedule_id: schedule.id,
        cpt_code: rate.cpt,
        modifier: null,
        rate_cents: rate.cents,
        unit_type: "service",
      });
    }
  }
  return schedule;
}

export async function createTestPatient() {
  return tenantInsert<DataRow>("clients", {
    first_name: "Test",
    last_name: "Patient",
    sex: "U",
    client_status: "intake",
    registration_status: "not_started",
    billing_readiness_status: "not_ready",
    metadata: { synthetic: true, source: "onboarding" },
  });
}
