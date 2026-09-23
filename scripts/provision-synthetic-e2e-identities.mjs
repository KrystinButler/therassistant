const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, "");
const SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SECRET_KEY) {
  throw new Error("SUPABASE_URL and a local Supabase secret/service-role key are required.");
}

const identities = {
  staff: { email: process.env.E2E_STAFF_EMAIL, password: process.env.E2E_STAFF_PASSWORD },
  provider: { email: process.env.E2E_PROVIDER_EMAIL, password: process.env.E2E_PROVIDER_PASSWORD },
  patient: { email: process.env.E2E_PATIENT_EMAIL, password: process.env.E2E_PATIENT_PASSWORD },
};

for (const [role, identity] of Object.entries(identities)) {
  if (!identity.email || !identity.password) throw new Error(`Missing synthetic ${role} E2E credentials.`);
  const domain = identity.email.toLowerCase().split("@")[1] ?? "";
  if (!domain.endsWith(".test") && !domain.endsWith(".invalid")) {
    throw new Error(`${role} identity must use a reserved synthetic domain.`);
  }
}
if (new Set(Object.values(identities).map((value) => value.email.toLowerCase())).size !== 3) {
  throw new Error("Staff, provider, and patient E2E identities must be distinct.");
}

const headers = {
  apikey: SECRET_KEY,
  Authorization: `Bearer ${SECRET_KEY}`,
  "Content-Type": "application/json",
};

async function request(path, init = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} failed (${response.status}): ${text}`);
  return payload;
}

async function ensureAuthUser(email, password, role) {
  const list = await request("/auth/v1/admin/users?page=1&per_page=1000");
  const users = Array.isArray(list?.users) ? list.users : [];
  const existing = users.find((user) => String(user.email ?? "").toLowerCase() === email.toLowerCase());
  const body = JSON.stringify({
    email,
    password,
    email_confirm: true,
    user_metadata: { synthetic: true, e2e_role: role },
  });
  return existing
    ? request(`/auth/v1/admin/users/${existing.id}`, { method: "PUT", body })
    : request("/auth/v1/admin/users", { method: "POST", body });
}

async function upsert(table, rows) {
  await request(`/rest/v1/${table}?on_conflict=id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
}

const IDS = {
  tenant: "10000000-0000-4000-8000-000000000002",
  entity: "11000000-0000-4000-8000-000000000001",
  location: "12000000-0000-4000-8000-000000000001",
  provider: "20000000-0000-4000-8000-000000000001",
  patient: "40000000-0000-4000-8000-000000000001",
  appointment: "50000000-0000-4000-8000-000000000001",
  staffMembership: "e1000000-0000-4000-8000-000000000001",
  providerMembership: "e1000000-0000-4000-8000-000000000002",
  staffRole: "e2000000-0000-4000-8000-000000000001",
  providerRole: "e2000000-0000-4000-8000-000000000002",
  providerLink: "e3000000-0000-4000-8000-000000000001",
  patientPortal: "e4000000-0000-4000-8000-000000000001",
};

await upsert("tenants", [{
  id: IDS.tenant,
  name: "THERASSISTANT Synthetic E2E Practice",
  tenant_type: "practice",
  status: "active",
  timezone: "America/Denver",
  settings: { synthetic: true, e2e: true },
}]);

await upsert("practice_entities", [{
  id: IDS.entity,
  tenant_id: IDS.tenant,
  legal_name: "THERASSISTANT Synthetic E2E Practice LLC",
  dba_name: "Synthetic E2E Practice",
  entity_type: "llc",
  tax_id: "000000000",
  group_npi: "1003000001",
  taxonomy_code: "261QM0801X",
  status: "active",
}]);

await upsert("providers", [{
  id: IDS.provider,
  tenant_id: IDS.tenant,
  first_name: "Jamie",
  last_name: "Parker",
  credentials: "LCSW",
  provider_status: "active",
  individual_npi: "1003000002",
  taxonomy_code: "1041C0700X",
  email: identities.provider.email,
  phone: "303-555-0101",
  primary_specialty: "Behavioral Health",
}]);

await upsert("practice_locations", [{
  id: IDS.location,
  tenant_id: IDS.tenant,
  practice_entity_id: IDS.entity,
  name: "Synthetic Telehealth Location",
  location_type: "telehealth",
  city: "Test City",
  state: "CO",
  postal_code: "80000",
  phone: "303-555-0100",
  is_primary: true,
  status: "active",
}]);

await upsert("clients", [{
  id: IDS.patient,
  tenant_id: IDS.tenant,
  first_name: "Jordan",
  last_name: "Ellis",
  preferred_name: "Jordan",
  date_of_birth: "1992-04-18",
  email: identities.patient.email,
  phone: "303-555-0201",
  city: "Test City",
  state: "CO",
  postal_code: "80000",
  client_status: "active",
  registration_status: "complete",
  billing_readiness_status: "ready",
  metadata: { synthetic: true, e2e: true, billing_type: "self_pay" },
}]);

const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
tomorrow.setUTCHours(16, 0, 0, 0);
const appointmentEnd = new Date(tomorrow.getTime() + 53 * 60 * 1000);

await upsert("appointments", [{
  id: IDS.appointment,
  tenant_id: IDS.tenant,
  client_id: IDS.patient,
  provider_id: IDS.provider,
  starts_at: tomorrow.toISOString(),
  ends_at: appointmentEnd.toISOString(),
  appointment_status: "scheduled",
  location_type: "telehealth",
  service_type: "Individual Therapy",
  cpt_code: "90837",
  notes: "Synthetic E2E appointment. No real patient data.",
}]);

const staffUser = await ensureAuthUser(identities.staff.email, identities.staff.password, "staff");
const providerUser = await ensureAuthUser(identities.provider.email, identities.provider.password, "provider");
const patientUser = await ensureAuthUser(identities.patient.email, identities.patient.password, "patient");

await upsert("tenant_users", [
  { id: IDS.staffMembership, tenant_id: IDS.tenant, user_id: staffUser.id, status: "active", joined_at: new Date().toISOString() },
  { id: IDS.providerMembership, tenant_id: IDS.tenant, user_id: providerUser.id, status: "active", joined_at: new Date().toISOString() },
]);

await upsert("tenant_user_roles", [
  { id: IDS.staffRole, tenant_id: IDS.tenant, user_id: staffUser.id, role: "practice_admin" },
  { id: IDS.providerRole, tenant_id: IDS.tenant, user_id: providerUser.id, role: "clinician" },
]);

await upsert("provider_user_links", [
  { id: IDS.providerLink, tenant_id: IDS.tenant, provider_id: IDS.provider, user_id: providerUser.id, status: "active" },
]);

await upsert("client_portal_access", [
  {
    id: IDS.patientPortal,
    tenant_id: IDS.tenant,
    client_id: IDS.patient,
    user_id: patientUser.id,
    relationship: "self",
    status: "active",
    invited_email: identities.patient.email,
    invited_at: new Date().toISOString(),
    activated_at: new Date().toISOString(),
    created_by: staffUser.id,
  },
]);

console.log("Synthetic staff, provider, and patient E2E identities provisioned.");
