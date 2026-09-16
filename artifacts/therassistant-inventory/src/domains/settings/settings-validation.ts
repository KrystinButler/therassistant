import type {
  DiagnosisCodeInput,
  InterventionInput,
  PracticeLocationInput,
  ServiceCodeInput,
  SettingsNamespace,
  TenantSettings,
} from "./model";

const SETTINGS_NAMESPACES = new Set<SettingsNamespace>([
  "practice",
  "patient_records",
  "client_portal",
  "practice_billing",
  "patient_billing",
  "branding",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function trimmedNullable(value: string | null | undefined) {
  if (value === null || value === undefined) return null;
  const text = value.trim();
  return text || null;
}

function requireText(value: string, label: string) {
  const text = value.trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function requireNonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} cannot be negative.`);
  }
  return value;
}

function requirePositive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return value;
}

export function mergeTenantSettings(
  current: TenantSettings | Record<string, unknown>,
  patch: Partial<TenantSettings>,
): TenantSettings {
  const next: TenantSettings = { ...current };

  for (const [namespace, patchValue] of Object.entries(patch)) {
    if (!SETTINGS_NAMESPACES.has(namespace as SettingsNamespace)) {
      throw new Error(`Unsupported settings namespace: ${namespace}`);
    }
    if (!isPlainObject(patchValue)) {
      throw new Error(`Settings namespace ${namespace} must be an object.`);
    }

    const currentValue = isPlainObject(next[namespace]) ? next[namespace] : {};
    next[namespace] = { ...currentValue, ...patchValue };
  }

  return next;
}

export function validateServiceCode(input: ServiceCodeInput): ServiceCodeInput {
  const defaultDuration = input.default_duration_minutes;
  return {
    ...input,
    code: requireText(input.code, "Service code"),
    description: requireText(input.description, "Description"),
    default_fee_cents: requireNonNegative(input.default_fee_cents, "Default fee"),
    default_units: requirePositive(input.default_units, "Default units"),
    default_duration_minutes:
      defaultDuration === null || defaultDuration === undefined
        ? null
        : requirePositive(defaultDuration, "Default duration"),
    default_place_of_service: trimmedNullable(input.default_place_of_service),
    sort_order: Number.isFinite(input.sort_order) ? Math.trunc(input.sort_order) : 0,
  };
}

export function validateDiagnosisCode(input: DiagnosisCodeInput): DiagnosisCodeInput {
  return {
    ...input,
    code: requireText(input.code, "Diagnosis code"),
    description: requireText(input.description, "Description"),
    sort_order: Number.isFinite(input.sort_order) ? Math.trunc(input.sort_order) : 0,
  };
}

export function validateIntervention(input: InterventionInput): InterventionInput {
  return {
    ...input,
    name: requireText(input.name, "Intervention name"),
    category: trimmedNullable(input.category),
    sort_order: Number.isFinite(input.sort_order) ? Math.trunc(input.sort_order) : 0,
  };
}

export function validateLocation(input: PracticeLocationInput): PracticeLocationInput {
  return {
    ...input,
    name: requireText(input.name, "Location name"),
    address_line1: trimmedNullable(input.address_line1),
    address_line2: trimmedNullable(input.address_line2),
    city: trimmedNullable(input.city),
    state: trimmedNullable(input.state),
    postal_code: trimmedNullable(input.postal_code),
    phone: trimmedNullable(input.phone),
    email: trimmedNullable(input.email),
    place_of_service_code: trimmedNullable(input.place_of_service_code),
  };
}

export function nonNegativeCents(value: number | null | undefined, label: string) {
  if (value === null || value === undefined) return null;
  return requireNonNegative(value, label);
}

export function positiveInteger(value: number, label: string) {
  return Math.trunc(requirePositive(value, label));
}
