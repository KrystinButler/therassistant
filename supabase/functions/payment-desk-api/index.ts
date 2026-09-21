
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


async function requireCrmAccount(ctx: any, accountId: string) {
  const { data, error } = await ctx.supabaseAdmin
    .from("crm_accounts")
    .select("id,account_number,customer_name,original_balance_cents,status")
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new Error("Unable to verify CRM account.");
  if (!data) throw new Error("CRM account not found.");
  return data;
}

async function addCrmPaymentActivity(ctx: any, input: {
  accountId: string;
  transactionId: string;
  amountCents: number;
  actorEmail: string;
  summary?: string;
}) {
  const { error } = await ctx.supabaseAdmin.from("crm_activity").insert({
    account_id: input.accountId,
    activity_type: "payment",
    summary: input.summary || ("Payment received: $" + (input.amountCents / 100).toFixed(2) + "."),
    related_table: "payment_desk_transactions",
    related_id: input.transactionId,
    actor_email: input.actorEmail,
    metadata: { amountCents: input.amountCents },
  });
  if (error) throw new Error("Payment completed, but CRM activity could not be saved.");
}

async function allocateCrmPayment(
  ctx: any,
  accountId: string,
  transactionId: string,
  amountCents: number,
  actorEmail: string,
  preferredInstallmentId?: string | null,
) {
  const { data: existingAllocations, error: existingError } = await ctx.supabaseAdmin
    .from("crm_payment_allocations")
    .select("id")
    .eq("payment_transaction_id", transactionId)
    .limit(1);
  if (existingError) throw new Error("Unable to verify CRM payment allocation.");
  if ((existingAllocations ?? []).length > 0) return;

  const { data: plan, error: planError } = await ctx.supabaseAdmin
    .from("crm_payment_plans")
    .select("id")
    .eq("account_id", accountId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (planError) throw new Error("Unable to load CRM payment plan.");

  if (plan) {
    const { data: installments, error: installmentError } = await ctx.supabaseAdmin
      .from("crm_installments")
      .select("id,sequence_number,due_date,amount_due_cents,amount_paid_cents,status")
      .eq("plan_id", plan.id)
      .order("due_date", { ascending: true })
      .order("sequence_number", { ascending: true });
    if (installmentError) throw new Error("Unable to load CRM installments.");

    let remaining = amountCents;
    const rows = [...(installments ?? [])];
    if (preferredInstallmentId) {
      rows.sort((a: any, b: any) => {
        if (a.id === preferredInstallmentId) return -1;
        if (b.id === preferredInstallmentId) return 1;
        return String(a.due_date).localeCompare(String(b.due_date)) ||
          Number(a.sequence_number) - Number(b.sequence_number);
      });
    }

    for (const installment of rows) {
      if (remaining <= 0) break;
      if (installment.status === "waived") continue;
      const outstanding = Math.max(
        0,
        Number(installment.amount_due_cents) - Number(installment.amount_paid_cents),
      );
      if (outstanding <= 0) continue;
      const allocation = Math.min(outstanding, remaining);
      const newPaid = Number(installment.amount_paid_cents) + allocation;
      const paid = newPaid >= Number(installment.amount_due_cents);

      const { error: allocationError } = await ctx.supabaseAdmin
        .from("crm_payment_allocations")
        .insert({
          payment_transaction_id: transactionId,
          installment_id: installment.id,
          amount_cents: allocation,
        });
      if (allocationError) throw new Error("Payment completed, but CRM allocation could not be saved.");

      const { error: updateError } = await ctx.supabaseAdmin
        .from("crm_installments")
        .update({
          amount_paid_cents: newPaid,
          status: paid ? "paid" : "partial",
          paid_at: paid ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", installment.id);
      if (updateError) throw new Error("Payment completed, but installment status could not be updated.");
      remaining -= allocation;
    }
  }

  await addCrmPaymentActivity(ctx, {
    accountId,
    transactionId,
    amountCents,
    actorEmail,
  });
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
        .select("id,created_at,operator_email,customer_name,amount_cents,currency,reference,note,square_payment_id,square_status,receipt_url,card_brand,card_last4,failure_code,failure_detail,crm_account_id,square_environment")
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

      if (!newEmail || !newEmail.includes("@")) {
        return json({ error: "Enter a valid email address." }, 400);
      }
      if (newEmail === email) {
        return json({ error: "Your administrator account already has access." }, 400);
      }

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
        const alreadyExists =
          message.includes("already") ||
          message.includes("registered") ||
          message.includes("exists");
        if (!alreadyExists) {
          return json({ error: createError?.message || "Unable to create login." }, 400);
        }
      }

      const { error: upsertError } = await ctx.supabaseAdmin
        .from("payment_desk_users")
        .upsert(
          {
            email: newEmail,
            display_name: displayName || newEmail,
            role: "operator",
            active: true,
            must_change_password: createdAuthUser,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "email" },
        );

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
      if (targetEmail === email && !active) {
        return json({ error: "You cannot disable your own administrator access." }, 400);
      }

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

    if (req.method === "POST" && action === "create-payment-link") {
      if (access.must_change_password) {
        return json({ error: "Change your temporary password before creating a payment link." }, 403);
      }
      const body = await req.json().catch(() => ({}));
      const crmAccountId = String(body.crmAccountId ?? "").trim();
      const crmInstallmentId = String(body.crmInstallmentId ?? "").trim();
      const amountCents = Number(body.amountCents);
      const idempotencyKey = String(body.idempotencyKey ?? crypto.randomUUID()).trim();
      if (!crmAccountId) return json({ error: "CRM account is required." }, 400);
      if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > 10000000) {
        return json({ error: "Enter a valid payment amount." }, 400);
      }
      const account = await requireCrmAccount(ctx, crmAccountId);
      if (crmInstallmentId) {
        const { data: installment, error: installmentError } = await ctx.supabaseAdmin
          .from("crm_installments")
          .select("id,plan_id,crm_payment_plans!inner(account_id)")
          .eq("id", crmInstallmentId)
          .maybeSingle();
        if (installmentError || !installment || installment.crm_payment_plans?.account_id !== crmAccountId) {
          return json({ error: "Installment does not belong to this CRM account." }, 400);
        }
      }

      const environment = Deno.env.get("SQUARE_ENV") === "production" ? "production" : "sandbox";
      const accessToken = Deno.env.get("SQUARE_ACCESS_TOKEN");
      const locationId = Deno.env.get("SQUARE_LOCATION_ID");
      if (!accessToken || !locationId) return json({ error: "Square has not been connected to Payment Desk yet." }, 503);

      const squareResponse = await fetch(squareBase(environment) + "/v2/online-checkout/payment-links", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + accessToken,
          "Content-Type": "application/json",
          "Square-Version": Deno.env.get("SQUARE_API_VERSION") || "2026-09-16",
        },
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          description: "Therassistant CRM " + account.account_number,
          quick_pay: {
            name: "Account payment - " + account.account_number,
            price_money: { amount: amountCents, currency: "USD" },
            location_id: locationId,
          },
          payment_note: "Therassistant CRM | Account " + account.account_number,
        }),
      });
      const squareJson = await squareResponse.json().catch(() => ({}));
      const paymentLink = squareJson?.payment_link;
      const squareError = Array.isArray(squareJson?.errors) ? squareJson.errors[0] : null;
      if (!squareResponse.ok || !paymentLink?.url) {
        return json({ error: squareError?.detail || "Unable to create Square payment link.", code: squareError?.code || null }, 400);
      }

      const { data: savedLink, error: linkError } = await ctx.supabaseAdmin
        .from("crm_payment_links")
        .upsert({
          account_id: crmAccountId,
          installment_id: crmInstallmentId || null,
          amount_cents: amountCents,
          square_payment_link_id: paymentLink.id,
          square_order_id: paymentLink.order_id,
          url: paymentLink.url,
          status: "created",
          created_by: email,
          updated_at: new Date().toISOString(),
          square_environment: environment,
        }, { onConflict: "square_payment_link_id" })
        .select("*")
        .single();
      if (linkError) return json({ error: "Square link was created, but CRM could not save it." }, 500);

      await ctx.supabaseAdmin.from("crm_activity").insert({
        account_id: crmAccountId,
        activity_type: "payment_link",
        summary: "Payment link created for $" + (amountCents / 100).toFixed(2) + ".",
        related_table: "crm_payment_links",
        related_id: savedLink.id,
        actor_email: email,
        metadata: { amountCents },
      });

      return json({
        ok: true,
        paymentLink: {
          id: savedLink.id,
          squarePaymentLinkId: paymentLink.id,
          orderId: paymentLink.order_id,
          url: paymentLink.url,
          amountCents,
          status: savedLink.status,
        },
      });
    }

    if (req.method === "POST" && action === "refresh-payment-link") {
      const body = await req.json().catch(() => ({}));
      const internalLinkId = String(body.paymentLinkId ?? "").trim();
      if (!internalLinkId) return json({ error: "Payment link ID is required." }, 400);
      const { data: link, error: linkError } = await ctx.supabaseAdmin
        .from("crm_payment_links")
        .select("*")
        .eq("id", internalLinkId)
        .maybeSingle();
      if (linkError) return json({ error: "Unable to load CRM payment link." }, 500);
      if (!link) return json({ error: "CRM payment link not found." }, 404);

      const account = await requireCrmAccount(ctx, link.account_id);
      const environment = Deno.env.get("SQUARE_ENV") === "production" ? "production" : "sandbox";
      const accessToken = Deno.env.get("SQUARE_ACCESS_TOKEN");
      if (!accessToken) return json({ error: "Square has not been connected to Payment Desk yet." }, 503);

      const orderResponse = await fetch(
        squareBase(environment) + "/v2/orders/" + encodeURIComponent(link.square_order_id),
        {
          headers: {
            "Authorization": "Bearer " + accessToken,
            "Square-Version": Deno.env.get("SQUARE_API_VERSION") || "2026-09-16",
          },
        },
      );
      const orderJson = await orderResponse.json().catch(() => ({}));
      if (!orderResponse.ok) return json({ error: orderJson?.errors?.[0]?.detail || "Unable to check Square order." }, 400);

      const tender = Array.isArray(orderJson?.order?.tenders)
        ? orderJson.order.tenders.find((item: any) => item?.payment_id)
        : null;
      if (!tender?.payment_id) {
        return json({ ok: true, paymentLink: { ...link, status: "created" } });
      }

      const paymentResponse = await fetch(
        squareBase(environment) + "/v2/payments/" + encodeURIComponent(tender.payment_id),
        {
          headers: {
            "Authorization": "Bearer " + accessToken,
            "Square-Version": Deno.env.get("SQUARE_API_VERSION") || "2026-09-16",
          },
        },
      );
      const paymentJson = await paymentResponse.json().catch(() => ({}));
      const payment = paymentJson?.payment;
      if (!paymentResponse.ok || !payment) {
        return json({ error: paymentJson?.errors?.[0]?.detail || "Unable to load Square payment." }, 400);
      }
      if (payment.status !== "COMPLETED") {
        return json({ ok: true, paymentLink: { ...link, status: payment.status === "FAILED" ? "failed" : "created" } });
      }

      let transaction;
      const { data: existingTransaction, error: existingError } = await ctx.supabaseAdmin
        .from("payment_desk_transactions")
        .select("*")
        .eq("square_payment_id", payment.id)
        .maybeSingle();
      if (existingError) return json({ error: "Unable to reconcile Square payment." }, 500);

      if (existingTransaction) {
        transaction = existingTransaction;
      } else {
        const actualAmount = Number(payment?.amount_money?.amount ?? link.amount_cents);
        const row = {
          operator_email: link.created_by,
          customer_name: account.customer_name,
          amount_cents: actualAmount,
          currency: "USD",
          reference: account.account_number,
          note: "Paid through Square payment link",
          idempotency_key: ("payment-link:" + payment.id).slice(0, 80),
          square_payment_id: payment.id,
          square_status: payment.status,
          receipt_url: payment.receipt_url || null,
          card_brand: payment?.card_details?.card?.card_brand || null,
          card_last4: payment?.card_details?.card?.last_4 || null,
          failure_code: null,
          failure_detail: null,
          crm_account_id: link.account_id,
          square_environment: environment,
        };
        const { data: inserted, error: insertError } = await ctx.supabaseAdmin
          .from("payment_desk_transactions")
          .insert(row)
          .select("*")
          .single();
        if (insertError) return json({ error: "Square payment completed, but CRM audit record could not be saved. Do not charge again." }, 500);
        transaction = inserted;
      }

      await allocateCrmPayment(
        ctx,
        link.account_id,
        transaction.id,
        Number(transaction.amount_cents),
        link.created_by,
        link.installment_id,
      );

      const wasPaid = link.status === "paid";
      const { data: updatedLink, error: updateError } = await ctx.supabaseAdmin
        .from("crm_payment_links")
        .update({ status: "paid", updated_at: new Date().toISOString() })
        .eq("id", link.id)
        .select("*")
        .single();
      if (updateError) return json({ error: "Payment was reconciled, but payment-link status could not be updated." }, 500);

      if (!wasPaid) {
        await ctx.supabaseAdmin.from("crm_activity").insert({
          account_id: link.account_id,
          activity_type: "payment_link_paid",
          summary: "Square payment link paid: $" + (Number(transaction.amount_cents) / 100).toFixed(2) + ".",
          related_table: "payment_desk_transactions",
          related_id: transaction.id,
          actor_email: link.created_by,
          metadata: { paymentLinkId: link.id, squarePaymentId: payment.id },
        });
      }

      return json({ ok: true, paymentLink: updatedLink, transaction });
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
      const crmAccountId = String(body.crmAccountId ?? "").trim();
      const crmInstallmentId = String(body.crmInstallmentId ?? "").trim();

      if (crmAccountId) {
        await requireCrmAccount(ctx, crmAccountId);
      }

      if (!sourceId) return json({ error: "Card token is required." }, 400);
      if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > 10000000) {
        return json({ error: "Enter a valid payment amount." }, 400);
      }
      if (!customerName) return json({ error: "Customer name is required." }, 400);
      if (!idempotencyKey || idempotencyKey.length > 80) {
        return json({ error: "A valid payment request ID is required." }, 400);
      }

      const { data: existing } = await ctx.supabaseAdmin
        .from("payment_desk_transactions")
        .select("id,square_payment_id,square_status,receipt_url,amount_cents,customer_name,crm_account_id")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (existing) {
        if (existing.square_status === "COMPLETED" && existing.crm_account_id) {
          await allocateCrmPayment(
            ctx,
            existing.crm_account_id,
            existing.id,
            Number(existing.amount_cents),
            email,
            crmInstallmentId || null,
          );
        }
        return json({ ok: existing.square_status === "COMPLETED", duplicate: true, transaction: existing });
      }

      const environment = Deno.env.get("SQUARE_ENV") === "production" ? "production" : "sandbox";
      const accessToken = Deno.env.get("SQUARE_ACCESS_TOKEN");
      const locationId = Deno.env.get("SQUARE_LOCATION_ID");

      if (!accessToken || !locationId) {
        return json({ error: "Square has not been connected to Payment Desk yet." }, 503);
      }

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
        crm_account_id: crmAccountId || null,
        square_environment: environment,
      };

      const { data: saved, error: saveError } = await ctx.supabaseAdmin
        .from("payment_desk_transactions")
        .insert(row)
        .select("id,created_at,operator_email,customer_name,amount_cents,currency,reference,square_payment_id,square_status,receipt_url,card_brand,card_last4,failure_code,failure_detail,crm_account_id")
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

      if (saved.crm_account_id) {
        await allocateCrmPayment(
          ctx,
          saved.crm_account_id,
          saved.id,
          Number(saved.amount_cents),
          email,
          crmInstallmentId || null,
        );
      }

      return json({ ok: true, transaction: saved });
    }

    return json({ error: "Unknown Payment Desk action." }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected Payment Desk error." }, 500);
  }
});

Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  return secured(req);
});
