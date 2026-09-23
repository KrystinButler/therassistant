const SUPABASE_URL = (process.env.E2E_SUPABASE_URL ?? process.env.SUPABASE_URL)?.replace(/\/$/, "");
const PUBLISHABLE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.PUBLISHABLE_KEY ?? process.env.ANON_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !PUBLISHABLE_KEY || !SECRET_KEY) {
  throw new Error("Local Supabase E2E connection values are required.");
}

const identities = {
  staff: { email: process.env.E2E_STAFF_EMAIL, password: process.env.E2E_STAFF_PASSWORD },
  provider: { email: process.env.E2E_PROVIDER_EMAIL, password: process.env.E2E_PROVIDER_PASSWORD },
  patient: { email: process.env.E2E_PATIENT_EMAIL, password: process.env.E2E_PATIENT_PASSWORD },
};
for (const [role, identity] of Object.entries(identities)) {
  if (!identity.email || !identity.password) throw new Error("Missing synthetic " + role + " credentials.");
}

const IDS = {
  primaryPatient: "40000000-0000-4000-8000-000000000001",
  insuredPatient: "40000000-0000-4000-8000-000000000002",
  insuredAppointment: "50000000-0000-4000-8000-000000000002",
  otherTenant: "10000000-0000-4000-8000-000000000003",
  otherEntity: "11000000-0000-4000-8000-000000000002",
  otherLocation: "12000000-0000-4000-8000-000000000002",
  otherProvider: "20000000-0000-4000-8000-000000000002",
  otherPatient: "40000000-0000-4000-8000-000000000003",
  otherAppointment: "50000000-0000-4000-8000-000000000003",
};

async function request(path, options = {}) {
  const method = options.method ?? "GET";
  const key = options.key ?? PUBLISHABLE_KEY;
  const response = await fetch(SUPABASE_URL + path, {
    method,
    headers: {
      apikey: key,
      ...(options.token ? { Authorization: "Bearer " + options.token } : {}),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.prefer ? { Prefer: options.prefer } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok && !options.allowFailure) {
    throw new Error(method + " " + path + " failed (" + response.status + "): " + text);
  }
  return { response, payload };
}

async function serviceUpsert(table, rows) {
  await request("/rest/v1/" + table + "?on_conflict=id", {
    method: "POST",
    key: SECRET_KEY,
    token: SECRET_KEY,
    body: rows,
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

async function signIn(identity) {
  const result = await request("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: identity,
  });
  if (!result.payload?.access_token || !result.payload?.user?.id) {
    throw new Error("Synthetic sign-in did not return an access token.");
  }
  return { token: result.payload.access_token, userId: result.payload.user.id };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const start = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
start.setUTCHours(18, 0, 0, 0);
const end = new Date(start.getTime() + 53 * 60 * 1000);

await serviceUpsert("tenants", [{
  id: IDS.otherTenant,
  name: "THERASSISTANT Synthetic Isolation Practice",
  tenant_type: "practice",
  status: "active",
  timezone: "America/Denver",
  settings: { synthetic: true, e2e: true, isolation_fixture: true },
}]);
await serviceUpsert("practice_entities", [{
  id: IDS.otherEntity,
  tenant_id: IDS.otherTenant,
  legal_name: "THERASSISTANT Synthetic Isolation Practice LLC",
  dba_name: "Synthetic Isolation Practice",
  entity_type: "llc",
  tax_id: "111111111",
  group_npi: "1003000003",
  taxonomy_code: "261QM0801X",
  status: "active",
}]);
await serviceUpsert("providers", [{
  id: IDS.otherProvider,
  tenant_id: IDS.otherTenant,
  first_name: "Morgan",
  last_name: "Isolation",
  credentials: "LCSW",
  provider_status: "active",
  individual_npi: "1003000004",
  taxonomy_code: "1041C0700X",
  email: "other.provider@example.test",
  primary_specialty: "Behavioral Health",
}]);
await serviceUpsert("practice_locations", [{
  id: IDS.otherLocation,
  tenant_id: IDS.otherTenant,
  practice_entity_id: IDS.otherEntity,
  name: "Synthetic Isolation Telehealth",
  location_type: "telehealth",
  city: "Test City",
  state: "CO",
  postal_code: "80001",
  phone: "303-555-0300",
  is_primary: true,
  status: "active",
}]);
await serviceUpsert("clients", [{
  id: IDS.otherPatient,
  tenant_id: IDS.otherTenant,
  first_name: "Casey",
  last_name: "Isolation",
  preferred_name: "Casey",
  date_of_birth: "1990-01-01",
  email: "other.tenant.patient@example.test",
  phone: "303-555-0301",
  city: "Test City",
  state: "CO",
  postal_code: "80001",
  client_status: "active",
  registration_status: "complete",
  billing_readiness_status: "ready_for_charge",
  metadata: { synthetic: true, e2e: true, billing_type: "self_pay" },
}]);
await serviceUpsert("appointments", [{
  id: IDS.otherAppointment,
  tenant_id: IDS.otherTenant,
  client_id: IDS.otherPatient,
  provider_id: IDS.otherProvider,
  starts_at: start.toISOString(),
  ends_at: end.toISOString(),
  appointment_status: "scheduled",
  location_type: "telehealth",
  service_type: "Individual Therapy",
  cpt_code: "90837",
  notes: "Synthetic cross-tenant isolation fixture.",
}]);

const staff = await signIn(identities.staff);
const provider = await signIn(identities.provider);
const patient = await signIn(identities.patient);
assert(new Set([staff.userId, provider.userId, patient.userId]).size === 3, "Staff, provider, and patient identities must be distinct.");

const filter = "select=id,tenant_id&id=in.(" + [IDS.primaryPatient, IDS.insuredPatient, IDS.otherPatient].join(",") + ")&order=id.asc";

for (const [label, session] of [["staff", staff], ["provider", provider]]) {
  const result = await request("/rest/v1/clients?" + filter, { token: session.token });
  const ids = Array.isArray(result.payload) ? result.payload.map((row) => row.id) : [];
  assert(ids.includes(IDS.primaryPatient) && ids.includes(IDS.insuredPatient), label + " could not read own-tenant patients.");
  assert(!ids.includes(IDS.otherPatient), label + " could read a cross-tenant patient.");

  const blocked = await request("/rest/v1/clients?id=eq." + IDS.otherPatient + "&select=id", {
    method: "PATCH",
    token: session.token,
    body: { preferred_name: "Blocked" },
    prefer: "return=representation",
    allowFailure: true,
  });
  if (blocked.response.ok) {
    assert(Array.isArray(blocked.payload) && blocked.payload.length === 0, label + " updated a cross-tenant patient.");
  }
}

const patientDirect = await request("/rest/v1/clients?" + filter, { token: patient.token });
assert(Array.isArray(patientDirect.payload) && patientDirect.payload.length === 0, "Patient portal identity received direct staff-style patient-table access.");

const portal = await request("/rest/v1/rpc/get_my_patient_portal_data", {
  method: "POST",
  token: patient.token,
  body: {},
});
assert(portal.payload?.patient?.id === IDS.primaryPatient, "Patient portal did not resolve only the linked patient.");

async function assertCheckinDenied(appointmentId, label) {
  const result = await request("/rest/v1/rpc/portal_save_previsit_checkin", {
    method: "POST",
    token: patient.token,
    body: { p_appointment_id: appointmentId, p_update: { demographics_confirmed: true } },
    allowFailure: true,
  });
  assert(!result.response.ok, "Patient portal accessed " + label + ".");
}

await assertCheckinDenied(IDS.insuredAppointment, "another patient's appointment in the same tenant");
await assertCheckinDenied(IDS.otherAppointment, "an appointment in another tenant");

const unchanged = await request("/rest/v1/clients?id=eq." + IDS.otherPatient + "&select=preferred_name", {
  key: SECRET_KEY,
  token: SECRET_KEY,
});
assert(unchanged.payload?.[0]?.preferred_name === "Casey", "Cross-tenant write-denial control failed.");

console.log("Synthetic isolation verified for distinct staff, provider, and patient identities.");
