const SUPABASE_URL = (process.env.E2E_SUPABASE_URL ?? process.env.SUPABASE_URL)?.replace(/\/$/, "");
const PUBLISHABLE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.PUBLISHABLE_KEY ?? process.env.ANON_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const API_BASE_URL = (process.env.API_BASE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");

if (!SUPABASE_URL || !PUBLISHABLE_KEY || !SECRET_KEY) {
  throw new Error("Local Supabase E2E connection values are required.");
}

const identities = {
  staff: { email: process.env.E2E_STAFF_EMAIL, password: process.env.E2E_STAFF_PASSWORD },
  provider: { email: process.env.E2E_PROVIDER_EMAIL, password: process.env.E2E_PROVIDER_PASSWORD },
  patient: { email: process.env.E2E_PATIENT_EMAIL, password: process.env.E2E_PATIENT_PASSWORD },
};
for (const [label, identity] of Object.entries(identities)) {
  if (!identity.email || !identity.password) throw new Error(`Missing synthetic ${label} credentials.`);
}

const IDS = {
  tenant: "10000000-0000-4000-8000-000000000002",
  otherTenant: "10000000-0000-4000-8000-000000000003",
  provider: "20000000-0000-4000-8000-000000000001",
  otherProviderSameTenant: "20000000-0000-4000-8000-000000000099",
  otherTenantProvider: "20000000-0000-4000-8000-000000000002",
  patient: "40000000-0000-4000-8000-000000000001",
  otherTenantPatient: "40000000-0000-4000-8000-000000000003",
  providerNote: "71000000-0000-4000-8000-000000000001",
  otherProviderNote: "71000000-0000-4000-8000-000000000002",
  otherTenantNote: "71000000-0000-4000-8000-000000000003",
  psychotherapyNote: "71000000-0000-4000-8000-000000000004",
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function supabaseRequest(path, options = {}) {
  const key = options.key ?? PUBLISHABLE_KEY;
  const response = await fetch(SUPABASE_URL + path, {
    method: options.method ?? "GET",
    headers: {
      apikey: key,
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
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
    throw new Error(`${options.method ?? "GET"} ${path} failed (${response.status}): ${text}`);
  }
  return { response, payload };
}

async function serviceUpsert(table, rows) {
  await supabaseRequest(`/rest/v1/${table}?on_conflict=id`, {
    method: "POST",
    key: SECRET_KEY,
    token: SECRET_KEY,
    body: rows,
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

async function servicePatch(path, body) {
  await supabaseRequest(`/rest/v1/${path}`, {
    method: "PATCH",
    key: SECRET_KEY,
    token: SECRET_KEY,
    body,
    prefer: "return=minimal",
  });
}

async function signIn(identity) {
  const result = await supabaseRequest("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: identity,
  });
  assert(result.payload?.access_token && result.payload?.user?.id, "Synthetic sign-in did not return an authenticated user.");
  return { token: result.payload.access_token, userId: result.payload.user.id };
}

async function apiRequest(path, options = {}) {
  const response = await fetch(API_BASE_URL + path, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.tenantId ? { "X-Tenant-Id": options.tenantId } : {}),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  return { response, payload };
}

const [staff, provider, patient] = await Promise.all([
  signIn(identities.staff),
  signIn(identities.provider),
  signIn(identities.patient),
]);

const serviceDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
await serviceUpsert("clinical_notes", [
  {
    id: IDS.providerNote,
    tenant_id: IDS.tenant,
    client_id: IDS.patient,
    provider_id: IDS.provider,
    note_type: "assessment",
    note_status: "ready_for_signature",
    service_date: serviceDate,
    cpt_code: "90791",
    diagnosis_code: "F41.1",
    note_text: "Synthetic provider-owned API authorization note.",
  },
  {
    id: IDS.otherProviderNote,
    tenant_id: IDS.tenant,
    client_id: IDS.patient,
    provider_id: IDS.otherProviderSameTenant,
    note_type: "assessment",
    note_status: "ready_for_signature",
    service_date: serviceDate,
    cpt_code: "90791",
    diagnosis_code: "F41.1",
    note_text: "Synthetic same-tenant foreign-provider note.",
  },
  {
    id: IDS.otherTenantNote,
    tenant_id: IDS.otherTenant,
    client_id: IDS.otherTenantPatient,
    provider_id: IDS.otherTenantProvider,
    note_type: "assessment",
    note_status: "ready_for_signature",
    service_date: serviceDate,
    cpt_code: "90791",
    diagnosis_code: "F41.1",
    note_text: "Synthetic cross-tenant note that must never leak.",
  },
  {
    id: IDS.psychotherapyNote,
    tenant_id: IDS.tenant,
    client_id: IDS.patient,
    provider_id: IDS.provider,
    note_type: "psychotherapy",
    note_status: "ready_for_signature",
    service_date: serviceDate,
    note_text: "Synthetic psychotherapy note excluded from the ordinary API path.",
  },
]);

const noToken = await apiRequest("/api/clinical", { tenantId: IDS.tenant });
assert(noToken.response.status === 401, `Clinical API without a token must return 401, received ${noToken.response.status}.`);

const noTenant = await apiRequest("/api/clinical", { token: provider.token });
assert(noTenant.response.status === 400, `Clinical API without X-Tenant-Id must return 400, received ${noTenant.response.status}.`);

const patientRead = await apiRequest("/api/clinical", { token: patient.token, tenantId: IDS.tenant });
assert(patientRead.response.status === 403, `Patient principal must not receive staff clinical-note access; received ${patientRead.response.status}.`);

const foreignMembership = await apiRequest("/api/clinical", { token: provider.token, tenantId: IDS.otherTenant });
assert(foreignMembership.response.status === 403, `Provider without membership in the requested tenant must return 403, received ${foreignMembership.response.status}.`);

const providerRead = await apiRequest("/api/clinical", { token: provider.token, tenantId: IDS.tenant });
assert(providerRead.response.status === 200 && Array.isArray(providerRead.payload), `Authorized clinician read failed (${providerRead.response.status}).`);
const providerIds = new Set(providerRead.payload.map((row) => row.id));
assert(providerIds.has(IDS.providerNote), "Clinician could not read their own ordinary clinical note.");
assert(!providerIds.has(IDS.otherProviderNote), "Clinician read another provider's same-tenant clinical note.");
assert(!providerIds.has(IDS.otherTenantNote), "Clinician read a cross-tenant clinical note.");
assert(!providerIds.has(IDS.psychotherapyNote), "Psychotherapy note leaked through the ordinary clinical API path.");

const staffRead = await apiRequest("/api/clinical", { token: staff.token, tenantId: IDS.tenant });
assert(staffRead.response.status === 200 && Array.isArray(staffRead.payload), `Practice administrator clinical read failed (${staffRead.response.status}).`);
const staffIds = new Set(staffRead.payload.map((row) => row.id));
assert(staffIds.has(IDS.providerNote) && staffIds.has(IDS.otherProviderNote), "Practice administrator could not read ordinary notes in its tenant.");
assert(!staffIds.has(IDS.otherTenantNote), "Practice administrator read a cross-tenant clinical note.");
assert(!staffIds.has(IDS.psychotherapyNote), "Practice administrator received psychotherapy-note content through the ordinary clinical API path.");

const adminSign = await apiRequest(`/api/clinical-notes/${IDS.otherProviderNote}/sign`, {
  method: "POST",
  token: staff.token,
  tenantId: IDS.tenant,
  body: {},
});
assert(adminSign.response.status === 403, `Administrator without clinician role must not sign notes; received ${adminSign.response.status}.`);

const foreignProviderSign = await apiRequest(`/api/clinical-notes/${IDS.otherProviderNote}/sign`, {
  method: "POST",
  token: provider.token,
  tenantId: IDS.tenant,
  body: {},
});
assert(foreignProviderSign.response.status === 404, `Clinician signing another provider's note must receive non-disclosing 404; received ${foreignProviderSign.response.status}.`);

const crossTenantSign = await apiRequest(`/api/clinical-notes/${IDS.otherTenantNote}/sign`, {
  method: "POST",
  token: provider.token,
  tenantId: IDS.tenant,
  body: {},
});
assert(crossTenantSign.response.status === 404, `Cross-tenant note signing must receive non-disclosing 404; received ${crossTenantSign.response.status}.`);

const psychotherapySign = await apiRequest(`/api/clinical-notes/${IDS.psychotherapyNote}/sign`, {
  method: "POST",
  token: provider.token,
  tenantId: IDS.tenant,
  body: {},
});
assert(psychotherapySign.response.status === 404, `Psychotherapy note must not be signable through the ordinary clinical API; received ${psychotherapySign.response.status}.`);

const ownSign = await apiRequest(`/api/clinical-notes/${IDS.providerNote}/sign`, {
  method: "POST",
  token: provider.token,
  tenantId: IDS.tenant,
  body: {},
});
assert(ownSign.response.status === 200, `Clinician could not sign their own note (${ownSign.response.status}).`);
assert(ownSign.payload?.note?.note_status === "signed", "Signed clinical note did not return signed status.");

const signature = await supabaseRequest(`/rest/v1/clinical_note_signatures?clinical_note_id=eq.${IDS.providerNote}&select=tenant_id,signer_id,provider_id`, {
  key: SECRET_KEY,
  token: SECRET_KEY,
});
assert(signature.payload?.length === 1, "Expected exactly one signature for the clinician-owned note.");
assert(signature.payload[0].tenant_id === IDS.tenant, "Signature tenant does not match the authenticated tenant.");
assert(signature.payload[0].signer_id === provider.userId, "Signature did not record the authenticated Supabase user ID.");
assert(signature.payload[0].provider_id === IDS.provider, "Signature did not record the linked provider ID.");

await servicePatch(`tenant_users?tenant_id=eq.${IDS.tenant}&user_id=eq.${provider.userId}`, { status: "suspended" });
const suspendedRead = await apiRequest("/api/clinical", { token: provider.token, tenantId: IDS.tenant });
assert(suspendedRead.response.status === 403, `Suspended tenant membership must return 403, received ${suspendedRead.response.status}.`);
await servicePatch(`tenant_users?tenant_id=eq.${IDS.tenant}&user_id=eq.${provider.userId}`, { status: "active" });

console.log("Clinical API authentication, tenant isolation, role checks, psychotherapy separation, and provider-bound signing verified.");
