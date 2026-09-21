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

function parsePlanDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, "Payment date must be YYYY-MM-DD.");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new HttpError(400, "Payment date is invalid.");
  return date;
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildSchedule(remainingBalanceCents: number, installmentCents: number, frequency: string, firstDueDate: string, startSequence = 1) {
  if (!Number.isInteger(remainingBalanceCents) || remainingBalanceCents <= 0) throw new HttpError(400, "Remaining balance must be positive.");
  if (!Number.isInteger(installmentCents) || installmentCents <= 0) throw new HttpError(400, "Installment amount must be positive.");
  if (!["weekly","biweekly","monthly"].includes(frequency)) throw new HttpError(400, "Payment frequency is invalid.");
  const first = parsePlanDate(firstDueDate);
  const anchorDay = first.getUTCDate();
  const rows = [];
  let remaining = remainingBalanceCents;
  let offset = 0;
  while (remaining > 0) {
    let due: Date;
    if (frequency === "monthly") {
      const base = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + offset, 1));
      const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
      base.setUTCDate(Math.min(anchorDay, lastDay));
      due = base;
    } else {
      const days = (frequency === "weekly" ? 7 : 14) * offset;
      due = new Date(first.getTime() + days * 86400000);
    }
    const amount = Math.min(installmentCents, remaining);
    rows.push({ sequence_number: startSequence + offset, due_date: dateOnly(due), amount_due_cents: amount, amount_paid_cents: 0, status: "upcoming" });
    remaining -= amount;
    offset += 1;
  }
  return rows;
}

async function loadPlanBundle(ctx: any, accountId: string) {
  const { data: plan, error } = await ctx.supabaseAdmin
    .from("crm_payment_plans")
    .select("*")
    .eq("account_id", accountId)
    .in("status", ["draft","active","defaulted"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new HttpError(500, "Unable to load payment plan.");
  if (!plan) return { plan: null, installments: [] };
  const { data: installments, error: installmentError } = await ctx.supabaseAdmin
    .from("crm_installments")
    .select("*")
    .eq("plan_id", plan.id)
    .order("sequence_number", { ascending: true });
  if (installmentError) throw new HttpError(500, "Unable to load payment installments.");
  return { plan, installments: installments ?? [] };
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

    if (req.method === "GET" && action === "plan") {
      const accountId = requireUuid(url.searchParams.get("accountId"), "Account ID");
      return json(await loadPlanBundle(ctx, accountId));
    }

    if (req.method === "POST" && action === "create-plan") {
      const body = await req.json().catch(() => ({}));
      const accountId = requireUuid(body.accountId, "Account ID");
      const { data: account, error: accountError } = await ctx.supabaseAdmin.from("crm_accounts").select("*").eq("id", accountId).maybeSingle();
      if (accountError) throw new HttpError(500, "Unable to load CRM account.");
      if (!account) throw new HttpError(404, "CRM account not found.");
      const summary = await accountSummary(ctx, account);
      if (summary.currentBalanceCents <= 0) throw new HttpError(400, "This account does not have a balance to place on a payment plan.");

      const downPaymentCents = Number(body.downPaymentCents ?? 0);
      const installmentCents = Number(body.installmentCents);
      const frequency = String(body.frequency ?? "");
      const firstInstallmentDate = String(body.firstInstallmentDate ?? "");
      const gracePeriodDays = Number(body.gracePeriodDays ?? 0);
      if (!Number.isInteger(downPaymentCents) || downPaymentCents < 0 || downPaymentCents >= summary.currentBalanceCents) throw new HttpError(400, "Down payment is invalid.");
      if (!Number.isInteger(gracePeriodDays) || gracePeriodDays < 0 || gracePeriodDays > 90) throw new HttpError(400, "Grace period is invalid.");
      const remainingBalanceCents = summary.currentBalanceCents - downPaymentCents;
      const schedule = buildSchedule(remainingBalanceCents, installmentCents, frequency, firstInstallmentDate);
      const last = schedule.at(-1)!;

      const planRow = {
        account_id: accountId,
        status: body.status === "active" ? "active" : "draft",
        balance_at_creation_cents: summary.currentBalanceCents,
        down_payment_cents: downPaymentCents,
        remaining_balance_cents: remainingBalanceCents,
        frequency,
        first_installment_date: firstInstallmentDate,
        installment_cents: installmentCents,
        installment_count: schedule.length,
        final_installment_cents: last.amount_due_cents,
        final_installment_date: last.due_date,
        grace_period_days: gracePeriodDays,
        special_terms: cleanText(body.specialTerms, 5000),
        agreement_status: "not_generated",
        agreement_version: 0,
        created_by: access.email,
        updated_by: access.email,
      };
      const { data: plan, error: planError } = await ctx.supabaseAdmin.from("crm_payment_plans").insert(planRow).select("*").single();
      if (planError) throw new HttpError(400, planError.message || "Unable to create payment plan.");

      const { error: versionError } = await ctx.supabaseAdmin.from("crm_payment_plan_versions").insert({
        plan_id: plan.id,
        version_number: 1,
        snapshot: { ...planRow, schedule },
        reason: "created",
        created_by: access.email,
      });
      if (versionError) throw new HttpError(500, "Payment plan was created but its version history could not be saved.");

      const installmentRows = schedule.map((row) => ({ ...row, plan_id: plan.id }));
      const { error: installmentError } = await ctx.supabaseAdmin.from("crm_installments").insert(installmentRows);
      if (installmentError) throw new HttpError(500, "Payment plan was created but its installments could not be saved.");

      await ctx.supabaseAdmin.from("crm_accounts").update({ status: "payment_plan", updated_by: access.email, updated_at: new Date().toISOString() }).eq("id", accountId);
      await addActivity(ctx, { accountId, activityType: "payment_plan_created", summary: `Payment plan created with ${schedule.length} installments.`, actorEmail: access.email, relatedTable: "crm_payment_plans", relatedId: plan.id, metadata: { downPaymentCents, installmentCents, frequency } });
      return json(await loadPlanBundle(ctx, accountId), 201);
    }

    if (req.method === "POST" && action === "modify-plan") {
      const body = await req.json().catch(() => ({}));
      const planId = requireUuid(body.planId, "Payment plan ID");
      const { data: plan, error: planError } = await ctx.supabaseAdmin.from("crm_payment_plans").select("*").eq("id", planId).maybeSingle();
      if (planError) throw new HttpError(500, "Unable to load payment plan.");
      if (!plan) throw new HttpError(404, "Payment plan not found.");
      const accountId = plan.account_id;
      const { data: account, error: accountError } = await ctx.supabaseAdmin.from("crm_accounts").select("*").eq("id", accountId).maybeSingle();
      if (accountError || !account) throw new HttpError(404, "CRM account not found.");
      const summary = await accountSummary(ctx, account);

      const { data: existingInstallments, error: existingError } = await ctx.supabaseAdmin.from("crm_installments").select("*").eq("plan_id", planId).order("sequence_number", { ascending: true });
      if (existingError) throw new HttpError(500, "Unable to load existing installments.");
      const preserved = (existingInstallments ?? []).filter((row: any) => Number(row.amount_paid_cents) > 0);
      const preservedOutstanding = preserved.reduce((sum: number, row: any) => sum + Math.max(0, Number(row.amount_due_cents) - Number(row.amount_paid_cents)), 0);
      const frequency = String(body.frequency ?? plan.frequency);
      const installmentCents = Number(body.installmentCents ?? plan.installment_cents);
      const firstInstallmentDate = String(body.firstInstallmentDate ?? plan.first_installment_date);
      const gracePeriodDays = Number(body.gracePeriodDays ?? plan.grace_period_days ?? 0);
      const amountForNewRows = Math.max(0, summary.currentBalanceCents - preservedOutstanding);
      const startSequence = preserved.reduce((max: number, row: any) => Math.max(max, Number(row.sequence_number)), 0) + 1;
      const schedule = amountForNewRows > 0 ? buildSchedule(amountForNewRows, installmentCents, frequency, firstInstallmentDate, startSequence) : [];

      const { error: deleteError } = await ctx.supabaseAdmin.from("crm_installments").delete().eq("plan_id", planId).eq("amount_paid_cents", 0);
      if (deleteError) throw new HttpError(500, "Unable to replace future installments.");
      if (schedule.length) {
        const { error: newInstallmentError } = await ctx.supabaseAdmin.from("crm_installments").insert(schedule.map((row) => ({ ...row, plan_id: planId })));
        if (newInstallmentError) throw new HttpError(500, "Unable to save revised installments.");
      }

      const agreementVersion = Number(plan.agreement_version || 0) + 1;
      const finalRow: any = schedule.at(-1) ?? preserved.at(-1);
      const patch = {
        status: body.status && ["draft","active","completed","defaulted","cancelled"].includes(String(body.status)) ? String(body.status) : plan.status,
        remaining_balance_cents: summary.currentBalanceCents,
        frequency,
        first_installment_date: firstInstallmentDate,
        installment_cents: installmentCents,
        installment_count: preserved.filter((row: any) => Number(row.amount_paid_cents) < Number(row.amount_due_cents)).length + schedule.length,
        final_installment_cents: finalRow ? Number(finalRow.amount_due_cents) : installmentCents,
        final_installment_date: finalRow ? String(finalRow.due_date) : firstInstallmentDate,
        grace_period_days: gracePeriodDays,
        special_terms: body.specialTerms !== undefined ? cleanText(body.specialTerms, 5000) : plan.special_terms,
        agreement_status: "not_generated",
        agreement_version: agreementVersion,
        updated_by: access.email,
        updated_at: new Date().toISOString(),
      };
      const { data: updated, error: updateError } = await ctx.supabaseAdmin.from("crm_payment_plans").update(patch).eq("id", planId).select("*").single();
      if (updateError) throw new HttpError(400, updateError.message || "Unable to revise payment plan.");

      const { data: priorVersions, error: versionLookupError } = await ctx.supabaseAdmin.from("crm_payment_plan_versions").select("version_number").eq("plan_id", planId).order("version_number", { ascending: false }).limit(1);
      if (versionLookupError) throw new HttpError(500, "Unable to load payment plan version history.");
      const nextVersion = (priorVersions?.[0]?.version_number ?? 0) + 1;
      const { error: versionError } = await ctx.supabaseAdmin.from("crm_payment_plan_versions").insert({ plan_id: planId, version_number: nextVersion, snapshot: { ...updated, schedule }, reason: "modified", created_by: access.email });
      if (versionError) throw new HttpError(500, "Payment plan was revised but its version history could not be saved.");
      await addActivity(ctx, { accountId, activityType: "payment_plan_modified", summary: "Payment plan terms modified; a new agreement is required.", actorEmail: access.email, relatedTable: "crm_payment_plans", relatedId: planId, metadata: { version: nextVersion } });
      return json(await loadPlanBundle(ctx, accountId));
    }

    if (req.method === "POST" && action === "set-agreement-status") {
      const body = await req.json().catch(() => ({}));
      const planId = requireUuid(body.planId, "Payment plan ID");
      const agreementStatus = String(body.agreementStatus ?? "");
      if (!["not_generated","generated","sent","signed","declined"].includes(agreementStatus)) throw new HttpError(400, "Agreement status is invalid.");
      const patch: Record<string, unknown> = { agreement_status: agreementStatus, updated_by: access.email, updated_at: new Date().toISOString() };
      if (agreementStatus === "generated") {
        const { data: currentPlan, error: currentError } = await ctx.supabaseAdmin.from("crm_payment_plans").select("agreement_version").eq("id", planId).maybeSingle();
        if (currentError || !currentPlan) throw new HttpError(404, "Payment plan not found.");
        patch.agreement_version = Math.max(1, Number(currentPlan.agreement_version || 0));
      }
      const { data: plan, error } = await ctx.supabaseAdmin.from("crm_payment_plans").update(patch).eq("id", planId).select("id,account_id,agreement_status,agreement_version").maybeSingle();
      if (error) throw new HttpError(400, error.message || "Unable to update agreement status.");
      if (!plan) throw new HttpError(404, "Payment plan not found.");
      await addActivity(ctx, { accountId: plan.account_id, activityType: "agreement_status", summary: `Payment plan agreement marked ${agreementStatus.replaceAll("_", " ")}.`, actorEmail: access.email, relatedTable: "crm_payment_plans", relatedId: plan.id });
      return json({ plan });
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
