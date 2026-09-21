
import { withSupabase } from "npm:@supabase/server";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

function squareBase(env: string) {
  return env === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

const secured = withSupabase({ auth: "user" }, async (req, ctx) => {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "me";
    const email = normalizeEmail(ctx.userClaims?.email);

    if (!email) return json({ error: "Authenticated email is required." }, 401);

    const { data: access, error: accessError } = await ctx.supabaseAdmin
      .from("payment_desk_users")
      .select("email, display_name, role, active, must_change_password")
      .eq("email", email)
      .maybeSingle();

    if (accessError) return json({ error: "Unable to verify Payment Desk access." }, 500);
    if (!access?.active) return json({ error: "This account is not authorized for Payment Desk." }, 403);

    const isAdmin = access.role === "admin";

    if (req.method === "GET" && action === "me") {
      const environment = Deno.env.get("SQUARE_ENV") === "production" ? "production" : "sandbox";
      const applicationId = Deno.env.get("SQUARE_APPLICATION_ID") || "";
      const locationId = Deno.env.get("SQUARE_LOCATION_ID") || "";
      const accessToken = Deno.env.get("SQUARE_ACCESS_TOKEN") || "";

      return json({
        user: access,
        square: {
          configured: Boolean(applicationId && locationId && accessToken),
          environment,
          applicationId,
          locationId,
          scriptUrl:
            environment === "production"
              ? "https://web.squarecdn.com/v1/square.js"
              : "https://sandbox.web.squarecdn.com/v1/square.js",
        },
      });
    }

    if (req.method === "GET" && action === "transactions") {
      const { data, error } = await ctx.supabaseAdmin
        .from("payment_desk_transactions")
        .select("id,created_at,operator_email,customer_name,amount_cents,currency,reference,note,square_payment_id,square_status,receipt_url,card_brand,card_last4,failure_code,failure_detail,square_environment")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) return json({ error: "Unable to load transaction history." }, 500);
      return json({ transactions: data ?? [] });
    }

    if (req.method === "GET" && action === "users") {
      if (!isAdmin) return json({ error: "Administrator access required." }, 403);
      const { data, error } = await ctx.supabaseAdmin
        .from("payment_desk_users")
        .select("email,display_name,role,active,must_change_password,created_at,updated_at")
        .order("created_at", { ascending: true });
      if (error) return json({ error: "Unable to load users." }, 500);
      return json({ users: data ?? [] });
    }

    if (req.method === "POST" && action === "create-user") {
      if (!isAdmin) return json({ error: "Administrator access required." }, 403);
      const body = await req.json().catch(() => ({}));
      const newEmail = normalizeEmail(body.email);
      const displayName = String(body.displayName ?? "").trim();
      if (!newEmail || !newEmail.includes("@")) return json({ error: "Enter a valid email address." }, 400);
      if (newEmail === email) return json({ error: "Your administrator account already has access." }, 400);

      const tempPassword = randomPassword();
      let createdAuthUser = false;
      let authMessage = "Existing Supabase account found; its current password was not changed.";

      const { data: created, error: createError } = await ctx.supabaseAdmin.auth.admin.createUser({
        email: newEmail,
        password: tempPassword,
        email_confirm: true,
      });

      if (!createError && created?.user) {
        createdAuthUser = true;
        authMessage = "A new login was created.";
      } else {
        const message = String(createError?.message ?? "").toLowerCase();
        const alreadyExists = message.includes("already") || message.includes("registered") || message.includes("exists");
        if (!alreadyExists) return json({ error: createError?.message || "Unable to create login." }, 400);
      }

      const { error: upsertError } = await ctx.supabaseAdmin
        .from("payment_desk_users")
        .upsert({
          email: newEmail,
          display_name: displayName || newEmail,
          role: "operator",
          active: true,
          must_change_password: createdAuthUser,
          updated_at: new Date().toISOString(),
        }, { onConflict: "email" });

      if (upsertError) return json({ error: "Login was created, but Payment Desk access could not be saved." }, 500);
      return json({
        ok: true,
        email: newEmail,
        displayName: displayName || newEmail,
        tempPassword: createdAuthUser ? tempPassword : null,
        message: authMessage,
      });
    }

    if (req.method === "POST" && action === "set-user-active") {
      if (!isAdmin) return json({ error: "Administrator access required." }, 403);
      const body = await req.json().catch(() => ({}));
      const targetEmail = normalizeEmail(body.email);
      const active = Boolean(body.active);
      if (!targetEmail) return json({ error: "Email is required." }, 400);
      if (targetEmail === email && !active) return json({ error: "You cannot disable your own administrator access." }, 400);

      const { error } = await ctx.supabaseAdmin
        .from("payment_desk_users")
        .update({ active, updated_at: new Date().toISOString() })
        .eq("email", targetEmail);
      if (error) return json({ error: "Unable to update user access." }, 500);
      return json({ ok: true });
    }

    if (req.method === "POST" && action === "password-changed") {
      const { error } = await ctx.supabaseAdmin
        .from("payment_desk_users")
        .update({ must_change_password: false, updated_at: new Date().toISOString() })
        .eq("email", email);
      if (error) return json({ error: "Password changed, but the account flag could not be updated." }, 500);
      return json({ ok: true });
    }

    if (req.method === "POST" && action === "charge") {
      if (access.must_change_password) {
        return json({ error: "Change your temporary password before processing a payment." }, 403);
      }

      const body = await req.json().catch(() => ({}));
      const sourceId = String(body.sourceId ?? "");
      const amountCents = Number(body.amountCents);
      const customerName = String(body.customerName ?? "").trim();
      const reference = String(body.reference ?? "").trim().slice(0, 80);
      const note = String(body.note ?? "").trim().slice(0, 300);
      const idempotencyKey = String(body.idempotencyKey ?? "").trim();

      if (!sourceId) return json({ error: "Card token is required." }, 400);
      if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > 10000000) {
        return json({ error: "Enter a valid payment amount." }, 400);
      }
      if (!customerName) return json({ error: "Customer name is required." }, 400);
      if (!idempotencyKey || idempotencyKey.length > 45) {
        return json({ error: "A valid payment request ID is required." }, 400);
      }

      const { data: existing } = await ctx.supabaseAdmin
        .from("payment_desk_transactions")
        .select("id,square_payment_id,square_status,receipt_url,amount_cents,customer_name,square_environment")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (existing) return json({ ok: existing.square_status === "COMPLETED", duplicate: true, transaction: existing });

      const environment = Deno.env.get("SQUARE_ENV") === "production" ? "production" : "sandbox";
      const accessToken = Deno.env.get("SQUARE_ACCESS_TOKEN");
      const locationId = Deno.env.get("SQUARE_LOCATION_ID");

      if (!accessToken || !locationId) return json({ error: "Square has not been connected to Payment Desk yet." }, 503);

      const paymentPayload: Record<string, unknown> = {
        source_id: sourceId,
        idempotency_key: idempotencyKey,
        amount_money: { amount: amountCents, currency: "USD" },
        location_id: locationId,
        autocomplete: true,
        note: [
          "Therassistant Payment Desk",
          "Operator: " + email,
          reference ? "Reference: " + reference : "",
          note ? "Note: " + note : "",
        ].filter(Boolean).join(" | ").slice(0, 500),
      };
      if (reference) paymentPayload.reference_id = reference.slice(0, 40);

      const squareResponse = await fetch(squareBase(environment) + "/v2/payments", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + accessToken,
          "Content-Type": "application/json",
          "Square-Version": Deno.env.get("SQUARE_API_VERSION") || "2026-09-16",
        },
        body: JSON.stringify(paymentPayload),
      });

      const squareJson = await squareResponse.json().catch(() => ({}));
      const payment = squareJson?.payment;
      const squareError = Array.isArray(squareJson?.errors) ? squareJson.errors[0] : null;

      const row = {
        operator_email: email,
        customer_name: customerName,
        amount_cents: amountCents,
        currency: "USD",
        reference: reference || null,
        note: note || null,
        idempotency_key: idempotencyKey,
        square_payment_id: payment?.id || null,
        square_status: payment?.status || (squareResponse.ok ? "UNKNOWN" : "FAILED"),
        receipt_url: payment?.receipt_url || null,
        card_brand: payment?.card_details?.card?.card_brand || null,
        card_last4: payment?.card_details?.card?.last_4 || null,
        failure_code: squareError?.code || null,
        failure_detail: squareError?.detail || null,
        square_environment: environment,
      };

      const { data: saved, error: saveError } = await ctx.supabaseAdmin
        .from("payment_desk_transactions")
        .insert(row)
        .select("id,created_at,operator_email,customer_name,amount_cents,currency,reference,square_payment_id,square_status,receipt_url,card_brand,card_last4,failure_code,failure_detail,square_environment")
        .single();

      if (saveError) {
        return json({
          error: "Square responded, but the audit record could not be saved. Do not retry until the Square dashboard is checked.",
          squarePaymentId: payment?.id || null,
          squareStatus: payment?.status || null,
        }, 500);
      }

      if (!squareResponse.ok || payment?.status !== "COMPLETED") {
        return json({
          error: squareError?.detail || "The payment was not completed.",
          code: squareError?.code || null,
          transaction: saved,
        }, 402);
      }

      return json({ ok: true, transaction: saved });
    }

    return json({ error: "Unknown Payment Desk action." }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected Payment Desk error." }, 500);
  }
});

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  return secured(req);
});
