import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = requiredEnv("SUPABASE_URL");
const PUBLIC_KEY = namedKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
const SECRET_KEY = namedKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
const MAIN_ORIGIN = "https://therassistant.vercel.app";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error("Missing " + name);
  return value;
}
function namedKey(current: string, legacy: string): string {
  const modern = Deno.env.get(current)?.trim();
  if (modern) {
    const parsed = JSON.parse(modern) as Record<string, unknown>;
    const key = typeof parsed.default === "string" ? parsed.default :
      Object.values(parsed).find((value): value is string => typeof value === "string" && value.length > 0);
    if (key) return key;
  }
  const older = Deno.env.get(legacy)?.trim();
  if (older) return older;
  throw new Error("Missing required API key configuration.");
}
function allowedOrigin(value: string | null): boolean {
  if (!value) return true;
  return value === MAIN_ORIGIN ||
    value === "https://therassistant-therassistant-1064.vercel.app" ||
    /^https:\/\/therassistant-[a-z0-9-]+-therassistant-1064\.vercel\.app$/.test(value);
}
function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (part) => part.toString(16).padStart(2, "0")).join("") + "Aa1!";
}
const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const responseHeaders = {
    "Access-Control-Allow-Origin": origin && allowedOrigin(origin) ? origin : MAIN_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store, private",
    "Vary": "Origin",
  };
  const reply = (value: Record<string, unknown>, status: number) =>
    new Response(JSON.stringify(value), { status, headers: responseHeaders });
  if (!allowedOrigin(origin)) return reply({ error: "Origin not allowed." }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405);

  const bearer = req.headers.get("Authorization");
  if (!bearer?.startsWith("Bearer ")) return reply({ error: "Authentication required." }, 401);
  const token = bearer.slice(7).trim();
  const userClient = createClient(SUPABASE_URL, PUBLIC_KEY, {
    global: { headers: { Authorization: bearer } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: auth, error: authError } = await userClient.auth.getUser(token);
  if (authError || !auth.user) return reply({ error: "Authenticated staff account required." }, 401);

  let tenantId: string;
  try {
    const body = await req.json() as { tenant_id?: string };
    tenantId = String(body?.tenant_id ?? "").trim();
    if (!UUID.test(tenantId)) return reply({ error: "Valid practice ID required." }, 400);
  } catch {
    return reply({ error: "Invalid request body." }, 400);
  }

  const [membershipResult, roleResult, tenantResult] = await Promise.all([
    userClient.from("tenant_users").select("id")
      .eq("tenant_id", tenantId).eq("user_id", auth.user.id).eq("status", "active").limit(1),
    userClient.from("tenant_user_roles").select("role")
      .eq("tenant_id", tenantId).eq("user_id", auth.user.id),
    userClient.from("tenants").select("id,status")
      .eq("id", tenantId).eq("status", "active").limit(1),
  ]);
  const isAdmin = (roleResult.data ?? []).some((row) =>
    row.role === "practice_admin" || row.role === "billing_company_admin");
  if (membershipResult.error || roleResult.error || tenantResult.error ||
      !membershipResult.data?.length || !tenantResult.data?.length || !isAdmin) {
    return reply({ error: "Only an active practice administrator may generate a synthetic patient login." }, 403);
  }
  const [entities, locations, providers] = await Promise.all([
    admin.from("practice_entities").select("id").eq("tenant_id", tenantId).limit(1),
    admin.from("practice_locations").select("id").eq("tenant_id", tenantId).limit(1),
    admin.from("providers").select("id").eq("tenant_id", tenantId).limit(1),
  ]);
  if (entities.error || locations.error || providers.error ||
      !entities.data?.length || !locations.data?.length || !providers.data?.length) {
    return reply({ error: "Configure a practice entity, location and provider before creating a synthetic patient." }, 409);
  }

  // A separate reserved-domain identity is never linked to a staff or real patient account.
  const password = randomPassword();
  let createdUserId: string | null = null;
  let createdPatientId: string | null = null;
  let createdAppointmentId: string | null = null;
  try {
    const { data: existing, error: existingError } = await admin.from("clients")
      .select("id,email").eq("tenant_id", tenantId)
      .contains("metadata", { synthetic: true, portal_test: true })
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (existingError) throw existingError;

    let patientId = existing?.id as string | undefined;
    let email = String(existing?.email ?? "");
    let userId: string | null = null;
    let accessId: string | null = null;
    if (patientId) {
      const { data: access, error: accessError } = await admin.from("client_portal_access")
        .select("id,user_id,invited_email").eq("tenant_id",tenantId)
        .eq("client_id",patientId).order("created_at",{ascending:false}).limit(1).maybeSingle();
      if (accessError) throw accessError;
      accessId = access?.id ?? null;
      userId = access?.user_id ?? null;
      if (userId) {
        const { error: pwError } = await admin.auth.admin.updateUserById(userId, {
          password, email_confirm: true,
        });
        if (pwError) throw pwError;
        email = String(access?.invited_email ?? email);
      }
    }
    if (!userId) {
      email = "therassistant-portal-test-" + crypto.randomUUID() + "@example.test";
      const { data: authUser, error: authCreateError } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { synthetic: true, portal_test: true },
      });
      if (authCreateError || !authUser.user) throw authCreateError ?? new Error("Test identity creation failed.");
      userId = authUser.user.id;
      createdUserId = userId;
    }
    if (!patientId) {
      const { data: patient, error: patientError } = await admin.from("clients").insert({
        tenant_id: tenantId,
        first_name: "Taylor",
        last_name: "Synthetic Test Patient",
        date_of_birth: "1990-01-01",
        email,
        client_status: "active",
        registration_status: "complete",
        metadata: { synthetic: true, portal_test: true, billing_type: "self_pay" },
      }).select("id").single();
      if (patientError || !patient) throw patientError ?? new Error("Synthetic patient creation failed.");
      patientId = patient.id;
      createdPatientId = patientId ?? null;
    }
    const now = new Date().toISOString();
    if (accessId) {
      const { error: accessError } = await admin.from("client_portal_access").update({
        user_id: userId, status: "active", invited_email: email,
        invited_at: now, activated_at: now, revoked_at: null,
      }).eq("id", accessId).eq("tenant_id", tenantId);
      if (accessError) throw accessError;
    } else {
      const { error: accessError } = await admin.from("client_portal_access").insert({
        tenant_id: tenantId, client_id: patientId, user_id: userId,
        relationship: "self", status: "active", invited_email: email,
        invited_at: now, activated_at: now, created_by: auth.user.id,
      });
      if (accessError) throw accessError;
    }
    const { data: future, error: apptError } = await admin.from("appointments")
      .select("id").eq("tenant_id", tenantId).eq("client_id", patientId)
      .gte("starts_at", now).order("starts_at",{ascending:true}).limit(1);
    if (apptError) throw apptError;
    if (!future?.length) {
      const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
      const { data: appt, error: apptCreateError } = await admin.from("appointments").insert({
        tenant_id: tenantId, client_id: patientId, provider_id: providers.data[0].id,
        starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
        appointment_status: "scheduled", service_type: "psychotherapy",
        location_type: "telehealth",
        notes: "Synthetic portal test appointment; not a real patient visit.",
      }).select("id").single();
      if (apptCreateError || !appt) throw apptCreateError ?? new Error("Synthetic appointment creation failed.");
      createdAppointmentId = appt.id;
    }
    const { error: auditError } = await admin.from("audit_logs").insert({
      tenant_id: tenantId, actor_id: auth.user.id, action: "provision_synthetic_patient_login",
      target_type: "client", target_id: patientId,
      metadata: { synthetic: true, portal_test: true, password_excluded: true },
    });
    if (auditError) throw auditError;
    return reply({
      email, password, login_path: "/patient-portal/login", patient_id: patientId,
      message: "Use these one-time credentials in a separate private browser window.",
    }, 200);
  } catch (error) {
    if (createdAppointmentId) {
      await admin.from("appointments").delete().eq("id", createdAppointmentId);
    }
    if (createdPatientId) {
      await admin.from("client_portal_access").delete().eq("client_id", createdPatientId);
      await admin.from("clients").delete().eq("id", createdPatientId);
    }
    if (createdUserId) await admin.auth.admin.deleteUser(createdUserId);
    // Never include Auth tokens or password material in a response or log.
    return reply({
      error: error instanceof Error && /duplicate|already exists/i.test(error.message) ?
        "A synthetic test account already exists. Retry after reviewing portal access." :
        "Synthetic patient setup failed. Check practice configuration and retry.",
    }, 500);
  }
});
