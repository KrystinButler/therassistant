const SUPABASE_URL = (
  process.env.E2E_SUPABASE_URL ??
  process.env.SUPABASE_URL
)?.replace(/\/$/, "");
const PUBLISHABLE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.PUBLISHABLE_KEY ??
  process.env.ANON_KEY;
const SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const identities = {
  staff: {
    email: process.env.E2E_STAFF_EMAIL,
    password: process.env.E2E_STAFF_PASSWORD,
  },
  patient: {
    email: process.env.E2E_PATIENT_EMAIL,
    password: process.env.E2E_PATIENT_PASSWORD,
  },
};

if (!SUPABASE_URL || !PUBLISHABLE_KEY || !SECRET_KEY) {
  throw new Error("Local Supabase URL, publishable key, and secret key are required.");
}
for (const [role, identity] of Object.entries(identities)) {
  if (!identity.email || !identity.password) {
    throw new Error(`Missing synthetic ${role} E2E credentials.`);
  }
  const domain = identity.email.toLowerCase().split("@")[1] ?? "";
  if (!domain.endsWith(".test") && !domain.endsWith(".invalid")) {
    throw new Error(`${role} identity must use a reserved synthetic domain.`);
  }
}

const IDS = {
  client: "40000000-0000-4000-8000-000000000001",
  appointment: "50000000-0000-4000-8000-000000000001",
  portalAccess: "e4000000-0000-4000-8000-000000000001",
};

async function request(path, {
  method = "GET",
  key = PUBLISHABLE_KEY,
  token,
  body,
  prefer,
  allowFailure = false,
} = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: key,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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

  if (!response.ok && !allowFailure) {
    throw new Error(
      `${method} ${path} failed (${response.status}): ${text}`,
    );
  }
  return { response, payload };
}

async function signIn(identity) {
  const { payload } = await request("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email: identity.email, password: identity.password },
  });
  if (!payload?.access_token || !payload?.user?.id) {
    throw new Error("Synthetic sign-in did not return a user and access token.");
  }
  return { token: payload.access_token, userId: payload.user.id };
}

async function rpc(token, name, body = {}) {
  const { payload } = await request(`/rest/v1/rpc/${name}`, {
    method: "POST",
    token,
    body,
  });
  return payload;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Reset the isolated portal row to the invitation state so activation is
// exercised by the patient principal rather than by the seeding principal.
await request(`/rest/v1/client_portal_access?id=eq.${IDS.portalAccess}`, {
  method: "PATCH",
  key: SECRET_KEY,
  token: SECRET_KEY,
  prefer: "return=representation",
  body: {
    status: "invited",
    activated_at: null,
    revoked_at: null,
  },
});

const staff = await signIn(identities.staff);
const patient = await signIn(identities.patient);
assert(
  staff.userId !== patient.userId,
  "Staff and patient lifecycle checks must use distinct Auth identities.",
);

const activated = await rpc(patient.token, "activate_my_client_portal_access");
assert(
  activated?.status === "active" && activated?.client_id === IDS.client,
  "Patient identity did not activate its own portal invitation.",
);

const activeContext = await rpc(patient.token, "get_my_client_portal_context");
assert(
  activeContext?.status === "active" && activeContext?.client_id === IDS.client,
  "Activated patient identity did not resolve the expected portal context.",
);

const checkin = await rpc(patient.token, "portal_save_previsit_checkin", {
  p_appointment_id: IDS.appointment,
  p_update: {
    demographics_confirmed: true,
    insurance_confirmed: true,
    visit_questions: {
      focus_today: "Synthetic lifecycle verification",
      feeling_since_last_visit: "stable",
    },
    consents: {
      information_accurate: true,
      privacy_acknowledged: true,
      care_acknowledged: true,
    },
    submitted: true,
  },
});
assert(
  checkin?.appointment_id === IDS.appointment &&
    checkin?.responses?.pre_visit?.submitted_at,
  "Synthetic patient pre-visit check-in was not saved.",
);

const journal = await rpc(patient.token, "portal_add_journal_entry", {
  p_entry_text: "Synthetic portal lifecycle journal entry.",
  p_mood: "stable",
  p_visibility: "shared_with_provider",
  p_tags: ["synthetic-e2e"],
  p_related_treatment_goal_id: null,
  p_entry_status: "submitted",
});
assert(
  journal?.client_id === IDS.client &&
    journal?.entry_text === "Synthetic portal lifecycle journal entry.",
  "Synthetic patient journal entry was not saved.",
);

const revoked = await rpc(staff.token, "revoke_client_portal_access", {
  p_client_id: IDS.client,
});
assert(
  revoked?.status === "revoked",
  "Staff identity did not revoke the synthetic patient portal.",
);

const blockedData = await request("/rest/v1/rpc/get_my_patient_portal_data", {
  method: "POST",
  token: patient.token,
  body: {},
  allowFailure: true,
});
assert(
  !blockedData.response.ok,
  "Revoked patient identity retained access to patient portal data.",
);

const restored = await rpc(staff.token, "restore_client_portal_access", {
  p_client_id: IDS.client,
});
assert(
  restored?.status === "active",
  "Staff identity did not restore the synthetic patient portal.",
);

const restoredData = await rpc(patient.token, "get_my_patient_portal_data");
assert(
  restoredData?.patient?.id === IDS.client,
  "Restored patient identity could not regain its portal data.",
);

// Exercise the real local Auth recovery endpoint. The existing browser contract
// separately verifies that a recovery callback is held at the password-update
// screen before tenant access.
const recovery = await request("/auth/v1/recover", {
  method: "POST",
  body: { email: identities.patient.email },
  allowFailure: true,
});
assert(
  recovery.response.ok,
  `Synthetic patient recovery request failed (${recovery.response.status}).`,
);

console.log(
  "Synthetic patient portal lifecycle verified with distinct staff and patient identities.",
);
