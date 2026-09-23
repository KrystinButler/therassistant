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

async function requireSeedRow(table, id) {
  const rows = await request(`/rest/v1/${table}?select=id&id=eq.${id}`, {
    headers: { Accept: "application/json" },
  });
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(`Synthetic E2E seed row ${table}:${id} is missing.`);
  }
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
  provider: "20000000-0000-4000-8000-000000000001",
  patient: "40000000-0000-4000-8000-000000000001",
  staffMembership: "e1000000-0000-4000-8000-000000000001",
  providerMembership: "e1000000-0000-4000-8000-000000000002",
  staffRole: "e2000000-0000-4000-8000-000000000001",
  providerRole: "e2000000-0000-4000-8000-000000000002",
  providerLink: "e3000000-0000-4000-8000-000000000001",
  patientPortal: "e4000000-0000-4000-8000-000000000001",
};

await Promise.all([
  requireSeedRow("tenants", IDS.tenant),
  requireSeedRow("providers", IDS.provider),
  requireSeedRow("clients", IDS.patient),
]);

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
