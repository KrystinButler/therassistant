import { withSupabase } from "npm:@supabase/server";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

const DOCUMENT_BUCKET = "crm-documents";
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
]);

type CrmAccess = {
  email: string;
  displayName: string;
  role: "admin" | "operator";
  active: boolean;
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function cleanText(value: unknown, max = 2000) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

function requireUuid(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new HttpError(400, `${label} is invalid.`);
  }
  return text;
}

function safeFileName(value: unknown) {
  const name = String(value ?? "document").trim().replace(/[^a-zA-Z0-9._ -]/g, "_").replace(/\s+/g, " ").slice(0, 120);
  return name || "document";
}

async function requireCrmAccess(ctx: any): Promise<CrmAccess> {
  const email = normalizeEmail(ctx.userClaims?.email);
  if (!email) throw new HttpError(401, "Authenticated email is required.");

  const { data, error } = await ctx.supabaseAdmin
    .from("payment_desk_users")
    .select("email,display_name,role,active")
    .eq("email", email)
    .maybeSingle();

  if (error) throw new HttpError(500, "Unable to verify CRM access.");
  if (!data?.active) throw new HttpError(403, "This account is not authorized for CRM.");
  if (data.role !== "admin" && data.role !== "operator") {
    throw new HttpError(403, "This account has an unsupported CRM role.");
  }

  return {
    email,
    displayName: data.display_name || email,
    role: data.role,
    active: true,
  };
}

function requireAdmin(access: CrmAccess) {
  if (access.role !== "admin") throw new HttpError(403, "Administrator access required.");
}

async function addActivity(ctx: any, input: {
  accountId: string;
  activityType: string;
  summary: string;
  actorEmail: string;
  relatedTable?: string | null;
  relatedId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await ctx.supabaseAdmin.from("crm_activity").insert({
    account_id: input.accountId,
    activity_type: input.activityType,
    summary: input.summary,
    related_table: input.relatedTable ?? null,
    related_id: input.relatedId ?? null,
    metadata: input.metadata ?? {},
    actor_email: input.actorEmail,
  });
  if (error) throw new HttpError(500, "Unable to save CRM activity.");
}

async function accountSummary(ctx: any, account: any) {
  const { data: payments, error: paymentError } = await ctx.supabaseAdmin
    .from("payment_desk_transactions")
    .select("id,created_at,amount_cents,square_status,receipt_url,card_brand,card_last4,operator_email")
    .eq("crm_account_id", account.id)
    .order("created_at", { ascending: false });
  if (paymentError) throw new HttpError(500, "Unable to load CRM payments.");

  const completedPaymentsCents = (payments ?? [])
    .filter((p: any) => p.square_status === "COMPLETED")
    .reduce((sum: number, p: any) => sum + Number(p.amount_cents || 0), 0);

  return {
    ...account,
    originalBalanceCents: account.original_balance_cents,
    completedPaymentsCents,
    currentBalanceCents: Math.max(0, Number(account.original_balance_cents) - completedPaymentsCents),
    payments: payments ?? [],
  };
}

const secured = withSupabase({ auth: "user" }, async (req, ctx) => {
  try {
    const access = await requireCrmAccess(ctx);
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "me";

    if (req.method === "GET" && action === "me") {
      return json({ user: access });
    }

    if (req.method === "GET" && action === "accounts") {
      const { data, error } = await ctx.supabaseAdmin.from("crm_accounts").select("*").order("customer_name", { ascending: true });
      if (error) throw new HttpError(500, "Unable to load CRM accounts.");
      const accounts = [];
      for (const account of data ?? []) accounts.push(await accountSummary(ctx, account));
      return json({ accounts });
    }

    if (req.method === "GET" && action === "account") {
      const accountId = requireUuid(url.searchParams.get("accountId"), "Account ID");
      const { data, error } = await ctx.supabaseAdmin.from("crm_accounts").select("*").eq("id", accountId).maybeSingle();
      if (error) throw new HttpError(500, "Unable to load CRM account.");
      if (!data) throw new HttpError(404, "CRM account not found.");
      return json({ account: await accountSummary(ctx, data) });
    }

    if (req.method === "POST" && action === "create-account") {
      requireAdmin(access);
      const body = await req.json().catch(() => ({}));
      const customerName = cleanText(body.customerName, 160);
      const accountNumber = cleanText(body.accountNumber, 80);
      const originalBalanceCents = Number(body.originalBalanceCents);
      if (!customerName) throw new HttpError(400, "Customer name is required.");
      if (!accountNumber) throw new HttpError(400, "Account number is required.");
      if (!Number.isInteger(originalBalanceCents) || originalBalanceCents < 0) throw new HttpError(400, "Original balance is invalid.");

      const row = {
        account_number: accountNumber,
        customer_name: customerName,
        phone: cleanText(body.phone, 40),
        email: normalizeEmail(body.email) || null,
        address_line1: cleanText(body.addressLine1, 160),
        address_line2: cleanText(body.addressLine2, 160),
        city: cleanText(body.city, 100),
        state: cleanText(body.state, 40),
        postal_code: cleanText(body.postalCode, 20),
        original_balance_cents: originalBalanceCents,
        status: "active",
        created_by: access.email,
        updated_by: access.email,
      };
      const { data, error } = await ctx.supabaseAdmin.from("crm_accounts").insert(row).select("*").single();
      if (error) throw new HttpError(400, error.message || "Unable to create CRM account.");
      await addActivity(ctx, { accountId: data.id, activityType: "account_created", summary: `Account ${data.account_number} created for ${data.customer_name}.`, actorEmail: access.email, relatedTable: "crm_accounts", relatedId: data.id });
      return json({ account: await accountSummary(ctx, data) }, 201);
    }

    if (req.method === "POST" && action === "update-account") {
      const body = await req.json().catch(() => ({}));
      const accountId = requireUuid(body.accountId, "Account ID");
      if (body.originalBalanceCents !== undefined && access.role !== "admin") requireAdmin(access);

      const patch: Record<string, unknown> = { updated_by: access.email, updated_at: new Date().toISOString() };
      if (body.customerName !== undefined) patch.customer_name = cleanText(body.customerName, 160);
      if (body.phone !== undefined) patch.phone = cleanText(body.phone, 40);
      if (body.email !== undefined) patch.email = normalizeEmail(body.email) || null;
      if (body.addressLine1 !== undefined) patch.address_line1 = cleanText(body.addressLine1, 160);
      if (body.addressLine2 !== undefined) patch.address_line2 = cleanText(body.addressLine2, 160);
      if (body.city !== undefined) patch.city = cleanText(body.city, 100);
      if (body.state !== undefined) patch.state = cleanText(body.state, 40);
      if (body.postalCode !== undefined) patch.postal_code = cleanText(body.postalCode, 20);
      if (body.status !== undefined) {
        const status = String(body.status);
        if (!["active", "payment_plan", "paid", "closed"].includes(status)) throw new HttpError(400, "Account status is invalid.");
        patch.status = status;
      }
      if (body.nextFollowUpAt !== undefined) patch.next_follow_up_at = body.nextFollowUpAt || null;
      if (body.originalBalanceCents !== undefined) {
        const cents = Number(body.originalBalanceCents);
        if (!Number.isInteger(cents) || cents < 0) throw new HttpError(400, "Original balance is invalid.");
        patch.original_balance_cents = cents;
      }

      const { data, error } = await ctx.supabaseAdmin.from("crm_accounts").update(patch).eq("id", accountId).select("*").maybeSingle();
      if (error) throw new HttpError(400, error.message || "Unable to update CRM account.");
      if (!data) throw new HttpError(404, "CRM account not found.");
      await addActivity(ctx, { accountId, activityType: "account_updated", summary: "Account details updated.", actorEmail: access.email, relatedTable: "crm_accounts", relatedId: accountId });
      return json({ account: await accountSummary(ctx, data) });
    }

    if (req.method === "POST" && action === "delete-account") {
      requireAdmin(access);
      const body = await req.json().catch(() => ({}));
      const accountId = requireUuid(body.accountId, "Account ID");
      const { error } = await ctx.supabaseAdmin.from("crm_accounts").delete().eq("id", accountId);
      if (error) throw new HttpError(400, error.message || "Unable to delete CRM account.");
      return json({ ok: true });
    }

    if (req.method === "GET" && action === "calls") {
      const accountId = requireUuid(url.searchParams.get("accountId"), "Account ID");
      const { data, error } = await ctx.supabaseAdmin.from("crm_calls").select("*").eq("account_id", accountId).order("created_at", { ascending: false });
      if (error) throw new HttpError(500, "Unable to load call history.");
      return json({ calls: data ?? [] });
    }

    if (req.method === "POST" && action === "create-call") {
      const body = await req.json().catch(() => ({}));
      const accountId = requireUuid(body.accountId, "Account ID");
      const direction = String(body.direction ?? "");
      const disposition = String(body.disposition ?? "");
      if (!["inbound", "outbound"].includes(direction)) throw new HttpError(400, "Call direction is invalid.");
      if (!["paid","payment_plan_discussed","promise_to_pay","no_answer","left_voicemail","follow_up_needed","dispute_question","other"].includes(disposition)) throw new HttpError(400, "Call disposition is invalid.");
      const promiseCents = body.promiseToPayCents == null || body.promiseToPayCents === "" ? null : Number(body.promiseToPayCents);
      if (promiseCents !== null && (!Number.isInteger(promiseCents) || promiseCents < 0)) throw new HttpError(400, "Promise-to-pay amount is invalid.");
      const row = {
        account_id: accountId,
        direction,
        disposition,
        notes: cleanText(body.notes, 5000),
        promise_to_pay_cents: promiseCents,
        promise_to_pay_date: body.promiseToPayDate || null,
        next_follow_up_at: body.nextFollowUpAt || null,
        created_by: access.email,
      };
      const { data, error } = await ctx.supabaseAdmin.from("crm_calls").insert(row).select("*").single();
      if (error) throw new HttpError(400, error.message || "Unable to log call.");
      if (body.nextFollowUpAt) {
        await ctx.supabaseAdmin.from("crm_accounts").update({ next_follow_up_at: body.nextFollowUpAt, updated_by: access.email, updated_at: new Date().toISOString() }).eq("id", accountId);
      }
      await addActivity(ctx, { accountId, activityType: "call", summary: `Call logged: ${disposition.replaceAll("_", " ")}.`, actorEmail: access.email, relatedTable: "crm_calls", relatedId: data.id });
      return json({ call: data }, 201);
    }

    if (req.method === "GET" && action === "notes") {
      const accountId = requireUuid(url.searchParams.get("accountId"), "Account ID");
      const { data, error } = await ctx.supabaseAdmin.from("crm_notes").select("*").eq("account_id", accountId).order("created_at", { ascending: false });
      if (error) throw new HttpError(500, "Unable to load notes.");
      return json({ notes: data ?? [] });
    }

    if (req.method === "POST" && action === "create-note") {
      const body = await req.json().catch(() => ({}));
      const accountId = requireUuid(body.accountId, "Account ID");
      const note = cleanText(body.note, 10000);
      if (!note) throw new HttpError(400, "Note is required.");
      const { data, error } = await ctx.supabaseAdmin.from("crm_notes").insert({ account_id: accountId, note, created_by: access.email }).select("*").single();
      if (error) throw new HttpError(400, error.message || "Unable to add note.");
      await addActivity(ctx, { accountId, activityType: "note", summary: "Account note added.", actorEmail: access.email, relatedTable: "crm_notes", relatedId: data.id });
      return json({ note: data }, 201);
    }

    if (req.method === "GET" && action === "follow-ups") {
      const { data, error } = await ctx.supabaseAdmin.from("crm_accounts").select("id,account_number,customer_name,original_balance_cents,status,next_follow_up_at").not("next_follow_up_at", "is", null).order("next_follow_up_at", { ascending: true });
      if (error) throw new HttpError(500, "Unable to load follow-ups.");
      const followUps = [];
      for (const account of data ?? []) followUps.push(await accountSummary(ctx, account));
      return json({ followUps });
    }

    if (req.method === "GET" && action === "activity") {
      const accountId = requireUuid(url.searchParams.get("accountId"), "Account ID");
      const { data, error } = await ctx.supabaseAdmin.from("crm_activity").select("*").eq("account_id", accountId).order("created_at", { ascending: false }).limit(300);
      if (error) throw new HttpError(500, "Unable to load activity.");
      return json({ activity: data ?? [] });
    }

    if (req.method === "GET" && action === "documents") {
      const accountId = requireUuid(url.searchParams.get("accountId"), "Account ID");
      const { data, error } = await ctx.supabaseAdmin.from("crm_documents").select("*").eq("account_id", accountId).order("uploaded_at", { ascending: false });
      if (error) throw new HttpError(500, "Unable to load documents.");
      return json({ documents: data ?? [] });
    }

    if (req.method === "POST" && action === "create-document-upload") {
      const body = await req.json().catch(() => ({}));
      const accountId = requireUuid(body.accountId, "Account ID");
      const fileName = safeFileName(body.fileName);
      const mimeType = String(body.mimeType ?? "");
      const fileSize = Number(body.fileSize);
      if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new HttpError(400, "This document type is not allowed.");
      if (!Number.isInteger(fileSize) || fileSize < 1 || fileSize > MAX_FILE_SIZE) throw new HttpError(400, "Document size is invalid.");
      const objectPath = `${accountId}/${crypto.randomUUID()}/${fileName}`;
      const { data, error } = await ctx.supabaseAdmin.storage.from(DOCUMENT_BUCKET).createSignedUploadUrl(objectPath);
      if (error || !data) throw new HttpError(500, "Unable to create document upload URL.");
      return json({ path: objectPath, token: data.token, signedUrl: data.signedUrl });
    }

    if (req.method === "POST" && action === "finalize-document") {
      const body = await req.json().catch(() => ({}));
      const accountId = requireUuid(body.accountId, "Account ID");
      const storagePath = String(body.storagePath ?? "");
      if (!storagePath.startsWith(`${accountId}/`)) throw new HttpError(400, "Document path does not belong to this account.");
      const mimeType = String(body.mimeType ?? "");
      const fileSize = Number(body.fileSize);
      if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new HttpError(400, "This document type is not allowed.");
      if (!Number.isInteger(fileSize) || fileSize < 1 || fileSize > MAX_FILE_SIZE) throw new HttpError(400, "Document size is invalid.");
      const category = String(body.category ?? "other");
      if (!["invoice","contract","correspondence","collection_notice","payment_plan_agreement","signed_payment_plan_agreement","other"].includes(category)) throw new HttpError(400, "Document category is invalid.");
      const { data, error } = await ctx.supabaseAdmin.from("crm_documents").insert({
        account_id: accountId,
        display_name: safeFileName(body.displayName || storagePath.split("/").at(-1)),
        storage_path: storagePath,
        mime_type: mimeType,
        file_size_bytes: fileSize,
        category,
        uploaded_by: access.email,
      }).select("*").single();
      if (error) throw new HttpError(400, error.message || "Unable to save document metadata.");
      await addActivity(ctx, { accountId, activityType: "document", summary: `Document uploaded: ${data.display_name}.`, actorEmail: access.email, relatedTable: "crm_documents", relatedId: data.id });
      return json({ document: data }, 201);
    }

    if (req.method === "POST" && action === "document-download") {
      const body = await req.json().catch(() => ({}));
      const documentId = requireUuid(body.documentId, "Document ID");
      const { data: document, error: documentError } = await ctx.supabaseAdmin.from("crm_documents").select("id,account_id,display_name,storage_path").eq("id", documentId).maybeSingle();
      if (documentError) throw new HttpError(500, "Unable to load document.");
      if (!document) throw new HttpError(404, "Document not found.");
      const { data, error } = await ctx.supabaseAdmin.storage.from(DOCUMENT_BUCKET).createSignedUrl(document.storage_path, 300, { download: document.display_name });
      if (error || !data?.signedUrl) throw new HttpError(500, "Unable to create document download URL.");
      return json({ url: data.signedUrl, expiresIn: 300 });
    }

    return json({ error: "Unknown CRM action." }, 404);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    return json({ error: error instanceof Error ? error.message : "Unexpected CRM error." }, 500);
  }
});

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  return secured(req);
});
