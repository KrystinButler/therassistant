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


const primaryTenant = "10000000-0000-4000-8000-000000000002";

// Verify the staff-transcribed journal path using the same JWT/RLS boundary as the browser.
const journalInput = {
  tenant_id: primaryTenant,
  client_id: IDS.insuredPatient,
  entry_text: "Synthetic patient-reported text transcribed by staff.",
  entry_date: new Date().toISOString().slice(0, 10),
  author_type: "patient",
  visibility: "shared_with_provider",
  recorded_by_staff_user_id: staff.userId,
  entry_status: "submitted",
};
const journalSaved = await request("/rest/v1/patient_journal_entries?select=id,recorded_by_staff_user_id", {
  method: "POST",
  token: staff.token,
  body: journalInput,
  prefer: "return=representation",
});
assert(journalSaved.payload?.[0]?.recorded_by_staff_user_id === staff.userId,
  "Staff could not create a properly attributed, shared patient journal entry.");

for (const [label, overrides] of [
  ["private journal", { visibility: "private" }],
  ["forged recorder", { recorded_by_staff_user_id: provider.userId }],
  ["cross-tenant journal", { client_id: IDS.otherPatient }],
]) {
  const denied = await request("/rest/v1/patient_journal_entries?select=id", {
    method: "POST",
    token: staff.token,
    body: { ...journalInput, ...overrides },
    prefer: "return=representation",
    allowFailure: true,
  });
  assert(!denied.response.ok || denied.payload?.length === 0,
    "RLS allowed staff to create a " + label + ".");
}

const clinicianJournal = await request(
  "/rest/v1/patient_journal_entries?select=id,recorded_by_staff_user_id&id=eq." + journalSaved.payload[0].id,
  { token: provider.token },
);
assert(clinicianJournal.payload?.[0]?.recorded_by_staff_user_id === staff.userId,
  "Clinician could not retrieve a shared, staff-transcribed journal entry.");

const patientJournalDirect = await request("/rest/v1/patient_journal_entries?select=id&id=eq." + journalSaved.payload[0].id, {
  token: patient.token,
});
assert(patientJournalDirect.payload?.length === 0,
  "Patient portal principal bypassed its restricted journal RPC by directly reading staff tables.");

// Exercise an actual private Storage upload/download, not a metadata-only document.
const proofText = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF";
const proofFile = new Blob([proofText], { type: "application/pdf" });
const objectPath = [primaryTenant, IDS.insuredPatient, crypto.randomUUID(), "e2e-proof.pdf"].join("/");
const storageHeaders = {
  apikey: PUBLISHABLE_KEY,
  Authorization: "Bearer " + staff.token,
  "Content-Type": "application/pdf",
  "x-upsert": "false",
};
const uploaded = await fetch(SUPABASE_URL + "/storage/v1/object/therassistant-documents/" + objectPath, {
  method: "POST",
  headers: storageHeaders,
  body: proofFile,
});
const uploadError = uploaded.ok ? "" : (await uploaded.text()).slice(0, 500);
assert(uploaded.ok, "Authenticated synthetic document upload failed (" + uploaded.status + "): " + uploadError);

const indexed = await request("/rest/v1/documents?select=id,storage_path", {
  method: "POST",
  token: staff.token,
  body: {
    tenant_id: primaryTenant,
    client_id: IDS.insuredPatient,
    document_type: "other",
    document_status: "uploaded",
    file_name: "e2e-proof.pdf",
    storage_path: objectPath,
    mime_type: "application/pdf",
    file_size_bytes: proofFile.size,
    uploaded_by: staff.userId,
  },
  prefer: "return=representation",
});
assert(indexed.payload?.[0]?.storage_path === objectPath,
  "Uploaded private document bytes were not linked to their metadata.");

const privateUrl = SUPABASE_URL + "/storage/v1/object/authenticated/therassistant-documents/" + objectPath;
const download = await fetch(privateUrl, {
  headers: { apikey: PUBLISHABLE_KEY, Authorization: "Bearer " + staff.token },
});
assert(download.ok && await download.text() === proofText,
  "Authenticated private document download failed to return the original bytes.");

const deniedStorage = await fetch(privateUrl, {
  headers: { apikey: PUBLISHABLE_KEY, Authorization: "Bearer " + patient.token },
});
assert(!deniedStorage.ok,
  "A patient portal principal downloaded a staff-only Storage object without authorization.");

const crossTenantUpload = await fetch(
  SUPABASE_URL + "/storage/v1/object/therassistant-documents/" +
    [IDS.otherTenant, IDS.otherPatient, crypto.randomUUID(), "forbidden.txt"].join("/"),
  { method: "POST", headers: storageHeaders, body: proofFile },
);
assert(!crossTenantUpload.ok, "Staff uploaded a private document outside its assigned tenant.");

const patientDocumentsDirect = await request("/rest/v1/documents?select=id&id=eq." + indexed.payload[0].id, {
  token: patient.token,
});
assert(patientDocumentsDirect.payload?.length === 0,
  "Patient portal principal bypassed the portal document RPC and read staff document metadata.");

console.log("Synthetic staff journals and private document byte transfers passed RLS isolation.");
