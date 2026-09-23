import { randomBytes } from "node:crypto";

const SUPABASE_URL = (process.env.E2E_SUPABASE_URL ?? process.env.SUPABASE_URL)?.replace(/\/$/, "");
const PUBLISHABLE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.PUBLISHABLE_KEY ??
  process.env.ANON_KEY;
const SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !PUBLISHABLE_KEY || !SECRET_KEY) {
  throw new Error("Local Supabase E2E connection values are required.");
}

const host = new URL(SUPABASE_URL).hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error("The full role matrix is restricted to the isolated local Supabase stack.");
}

const ROLES = [
  "platform_admin",
  "practice_admin",
  "billing_company_admin",
  "billing_manager",
  "biller",
  "clinician",
  "front_desk",
  "credentialing_specialist",
  "read_only",
  "client",
];

const READ_ONLY_ROLES = new Set(["read_only"]);
const NO_STAFF_READ_ROLES = new Set(["client"]);

const IDS = {
  tenant: "10000000-0000-4000-8000-000000000002",
  matrixPatient: "40000000-0000-4000-8000-000000000004",
  otherPatient: "40000000-0000-4000-8000-000000000003",
};

const matrixPassword = randomBytes(32).toString("hex");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok && !options.allowFailure) {
    throw new Error(method + " " + path + " failed (" + response.status + "): " + text);
  }

  return { response, payload };
}

async function serviceRequest(path, options = {}) {
  return request(path, {
    ...options,
    key: SECRET_KEY,
    token: SECRET_KEY,
  });
}

async function serviceUpsert(table, rows) {
  await serviceRequest("/rest/v1/" + table + "?on_conflict=id", {
    method: "POST",
    body: rows,
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

async function ensureAuthUser(email, role) {
  const list = await serviceRequest("/auth/v1/admin/users?page=1&per_page=1000");
  const users = Array.isArray(list.payload?.users) ? list.payload.users : [];
  const existing = users.find(
    (user) => String(user.email ?? "").toLowerCase() === email.toLowerCase(),
  );

  const body = {
    email,
    password: matrixPassword,
    email_confirm: true,
    user_metadata: { synthetic: true, e2e_role_matrix: role },
  };

  const result = existing
    ? await serviceRequest("/auth/v1/admin/users/" + existing.id, {
        method: "PUT",
        body,
      })
    : await serviceRequest("/auth/v1/admin/users", {
        method: "POST",
        body,
      });

  const user = result.payload?.user ?? result.payload;
  assert(user?.id, "Could not provision synthetic role identity for " + role + ".");
  return user;
}

async function signIn(email) {
  const result = await request("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email, password: matrixPassword },
  });
  assert(
    result.payload?.access_token && result.payload?.user?.id,
    "Synthetic role sign-in did not return an access token for " + email + ".",
  );
  return {
    token: result.payload.access_token,
    userId: result.payload.user.id,
  };
}

function rowId(prefix, index) {
  return prefix + "-0000-4000-8000-" + String(index + 1).padStart(12, "0");
}

await serviceUpsert("clients", [{
  id: IDS.matrixPatient,
  tenant_id: IDS.tenant,
  first_name: "Riley",
  last_name: "Matrix",
  preferred_name: "RoleMatrix",
  date_of_birth: "1991-02-03",
  email: "role.matrix.patient@example.test",
  phone: "303-555-0401",
  city: "Test City",
  state: "CO",
  postal_code: "80000",
  client_status: "active",
  registration_status: "complete",
  billing_readiness_status: "ready_for_charge",
  metadata: { synthetic: true, e2e: true, role_matrix_fixture: true },
}]);

const crossTenantControl = await serviceRequest(
  "/rest/v1/clients?id=eq." + IDS.otherPatient + "&select=id,preferred_name",
);
assert(
  Array.isArray(crossTenantControl.payload) && crossTenantControl.payload.length === 1,
  "Cross-tenant control fixture is missing. Run synthetic isolation before the role matrix.",
);

const identities = [];
for (let index = 0; index < ROLES.length; index += 1) {
  const role = ROLES[index];
  const email = "role." + role.replaceAll("_", "-") + "@example.test";
  const user = await ensureAuthUser(email, role);
  identities.push({ role, email, userId: user.id, index });
}

assert(
  new Set(identities.map((identity) => identity.userId)).size === ROLES.length,
  "Every system role must use a distinct Auth identity.",
);

await serviceUpsert(
  "tenant_users",
  identities.map((identity) => ({
    id: rowId("e1100000", identity.index),
    tenant_id: IDS.tenant,
    user_id: identity.userId,
    status: "active",
    joined_at: new Date().toISOString(),
  })),
);

await serviceUpsert(
  "tenant_user_roles",
  identities.map((identity) => ({
    id: rowId("e2100000", identity.index),
    tenant_id: IDS.tenant,
    user_id: identity.userId,
    role: identity.role,
  })),
);

let expectedPreferredName = "RoleMatrix";

for (const identity of identities) {
  const session = await signIn(identity.email);
  assert(
    session.userId === identity.userId,
    identity.role + " signed in as an unexpected Auth user.",
  );

  const ownRead = await request(
    "/rest/v1/clients?id=eq." + IDS.matrixPatient + "&select=id,preferred_name",
    { token: session.token },
  );
  const ownRows = Array.isArray(ownRead.payload) ? ownRead.payload : [];
  const expectsStaffRead = !NO_STAFF_READ_ROLES.has(identity.role);

  if (expectsStaffRead) {
    assert(
      ownRows.length === 1 && ownRows[0].id === IDS.matrixPatient,
      identity.role + " could not read own-tenant patient data.",
    );
  } else {
    assert(
      ownRows.length === 0,
      identity.role + " received staff-style direct patient-table read access.",
    );
  }

  const beforeWrite = expectedPreferredName;
  const nextPreferredName = "Matrix-" + identity.role;

  const ownWrite = await request(
    "/rest/v1/clients?id=eq." + IDS.matrixPatient + "&select=id,preferred_name",
    {
      method: "PATCH",
      token: session.token,
      body: { preferred_name: nextPreferredName },
      prefer: "return=representation",
      allowFailure: true,
    },
  );

  const expectsWrite =
    expectsStaffRead && !READ_ONLY_ROLES.has(identity.role);

  if (expectsWrite) {
    assert(ownWrite.response.ok, identity.role + " own-tenant update was rejected.");
    assert(
      Array.isArray(ownWrite.payload) &&
        ownWrite.payload.length === 1 &&
        ownWrite.payload[0].preferred_name === nextPreferredName,
      identity.role + " own-tenant update did not affect exactly one row.",
    );
    expectedPreferredName = nextPreferredName;
  } else if (ownWrite.response.ok) {
    assert(
      Array.isArray(ownWrite.payload) && ownWrite.payload.length === 0,
      identity.role + " unexpectedly updated own-tenant patient data.",
    );
  }

  const ownControl = await serviceRequest(
    "/rest/v1/clients?id=eq." + IDS.matrixPatient + "&select=preferred_name",
  );
  assert(
    ownControl.payload?.[0]?.preferred_name === expectedPreferredName,
    identity.role + " write-control verification failed. Previous value was " + beforeWrite + ".",
  );

  const crossRead = await request(
    "/rest/v1/clients?id=eq." + IDS.otherPatient + "&select=id,preferred_name",
    { token: session.token },
  );
  assert(
    Array.isArray(crossRead.payload) && crossRead.payload.length === 0,
    identity.role + " could read a cross-tenant patient.",
  );

  const crossWrite = await request(
    "/rest/v1/clients?id=eq." + IDS.otherPatient + "&select=id,preferred_name",
    {
      method: "PATCH",
      token: session.token,
      body: { preferred_name: "Blocked-" + identity.role },
      prefer: "return=representation",
      allowFailure: true,
    },
  );
  if (crossWrite.response.ok) {
    assert(
      Array.isArray(crossWrite.payload) && crossWrite.payload.length === 0,
      identity.role + " updated a cross-tenant patient.",
    );
  }

  const crossControl = await serviceRequest(
    "/rest/v1/clients?id=eq." + IDS.otherPatient + "&select=preferred_name",
  );
  assert(
    crossControl.payload?.[0]?.preferred_name === "Casey",
    identity.role + " cross-tenant write-denial control failed.",
  );
}

await serviceRequest(
  "/rest/v1/clients?id=eq." + IDS.matrixPatient,
  {
    method: "PATCH",
    body: { preferred_name: "RoleMatrix" },
    prefer: "return=minimal",
  },
);

console.log(
  "Full system role matrix verified: 10 distinct identities, tenant permissions, and cross-tenant denial.",
);
