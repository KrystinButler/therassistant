import { createHash } from "node:crypto";

const SUPABASE_URL = (process.env.E2E_SUPABASE_URL ?? process.env.SUPABASE_URL)?.replace(/\/$/, "");
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const STAFF_EMAIL = process.env.E2E_STAFF_EMAIL;
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD;

if (!SUPABASE_URL || !SECRET_KEY || !STAFF_EMAIL || !STAFF_PASSWORD) {
  throw new Error("Local Supabase and synthetic staff credentials are required.");
}

const IDS = {
  tenant: "10000000-0000-4000-8000-000000000002",
  insuredPatient: "40000000-0000-4000-8000-000000000002",
  payer: "30000000-0000-4000-8000-000000000001",
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const baseHeaders = {
  apikey: SECRET_KEY,
  "Content-Type": "application/json",
};

async function rawRequest(path, init = {}, token = SECRET_KEY) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      ...baseHeaders,
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  return response;
}

async function jsonRequest(path, init = {}, token = SECRET_KEY) {
  const response = await rawRequest(path, init, token);
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} failed (${response.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

const session = await jsonRequest(
  "/auth/v1/token?grant_type=password",
  {
    method: "POST",
    body: JSON.stringify({ email: STAFF_EMAIL, password: STAFF_PASSWORD }),
  },
);
const staffToken = session?.access_token;
assert(staffToken, "Synthetic staff sign-in failed.");

async function rows(table, query) {
  return jsonRequest(`/rest/v1/${table}?${query}`, {}, staffToken);
}

const claims = await rows(
  "professional_claims",
  `client_id=eq.${IDS.insuredPatient}&select=id,claim_status,total_charge_cents,patient_control_number,payer_id,paid_at&order=created_at.desc&limit=1`,
);
let claim = claims[0];
assert(claim, "Synthetic insured claim was not created.");
assert(claim.claim_status === "accepted", `Synthetic insured claim is ${claim.claim_status}, expected accepted.`);
assert(Number(claim.total_charge_cents) === 15000, "Synthetic insured claim charge is not $150.00.");
assert(claim.payer_id === IDS.payer, "Synthetic insured claim is linked to the wrong payer.");

const batchItems = await rows(
  "claim_batch_items",
  `claim_id=eq.${claim.id}&select=batch_id&limit=1`,
);
assert(batchItems[0]?.batch_id, "Synthetic insured claim was not batched.");
const batchId = batchItems[0].batch_id;

const batches = await rows(
  "claim_batches",
  `id=eq.${batchId}&select=id,batch_status,edi_storage_path,edi_file_name,edi_sha256,edi_byte_length,edi_archived_at&limit=1`,
);
const batch = batches[0];
assert(batch, "Synthetic insured batch was not found.");
assert(Boolean(batch.edi_archived_at), "Synthetic insured 837P was not archived.");
assert(Boolean(batch.edi_storage_path), "Synthetic insured 837P storage path is missing.");
assert(/^[0-9a-f]{64}$/.test(String(batch.edi_sha256 ?? "")), "Synthetic insured 837P hash is invalid.");
assert(Number(batch.edi_byte_length) > 0, "Synthetic insured 837P byte length is invalid.");

const ediResponse = await rawRequest(
  `/storage/v1/object/authenticated/claim-edis/${batch.edi_storage_path.split("/").map(encodeURIComponent).join("/")}`,
  {},
  staffToken,
);
if (!ediResponse.ok) throw new Error(`Archived 837P download failed (${ediResponse.status}): ${await ediResponse.text()}`);
const ediBytes = Buffer.from(await ediResponse.arrayBuffer());
const ediText = ediBytes.toString("utf8");
const ediHash = createHash("sha256").update(ediBytes).digest("hex");
assert(ediHash === batch.edi_sha256, "Archived 837P hash does not match batch metadata.");
assert(ediBytes.byteLength === Number(batch.edi_byte_length), "Archived 837P length does not match batch metadata.");
assert(ediText.includes("NM1*PR*2*Synthetic Commercial Payer*****PI*60054~"), "Archived 837P payer segment is missing.");
assert(ediText.includes("HI*ABK:F411~"), "Archived 837P diagnosis segment is missing.");
assert(ediText.includes("SV1*HC:90837*150.00*UN*1"), "Archived 837P service line is missing.");
assert(ediText.includes("***02:B:1*Y*A*Y*Y~"), "Archived 837P generic telehealth POS 02 claim segment is missing.");

const submissions = await rows(
  "claim_submissions",
  `batch_id=eq.${batchId}&select=id,submission_status,submission_method,response_payload&order=created_at.desc&limit=1`,
);
const submission = submissions[0];
assert(submission, "Synthetic insured external submission was not recorded.");
assert(submission.submission_status === "accepted", "Synthetic insured submission was not accepted.");
assert(submission.submission_method === "external_837p", "Synthetic insured submission method is incorrect.");

const responses = await rows(
  "submission_responses",
  `submission_id=eq.${submission.id}&claim_id=eq.${claim.id}&select=response_status,response_code,response_message,raw_response&order=created_at.desc&limit=1`,
);
const response = responses[0];
assert(response?.response_status === "accepted", "Synthetic insured acknowledgement was not accepted.");
assert(response?.response_code === "A1", "Synthetic insured acknowledgement code is incorrect.");
assert(response?.raw_response?.external_reference === "E2E-ACK-001", "Synthetic insured acknowledgement reference is missing.");
assert(response?.raw_response?.acknowledgement_type === "277CA", "Synthetic insured acknowledgement type is incorrect.");

const paymentBody = {
  p_tenant_id: IDS.tenant,
  p_amount_cents: 15000,
  p_source: "insurance",
  p_method: "eft",
  p_client_id: IDS.insuredPatient,
  p_payer_id: IDS.payer,
  p_claim_id: claim.id,
  p_allocation_cents: 15000,
  p_trace_number: "E2E-PAY-001",
  p_check_number: null,
  p_notes: "Synthetic isolated E2E insurance payment.",
  p_idempotency_key: "e2e-insured-payment-001",
};

const firstPayment = await jsonRequest(
  "/rest/v1/rpc/post_manual_payment",
  { method: "POST", body: JSON.stringify(paymentBody) },
  staffToken,
);
const replayPayment = await jsonRequest(
  "/rest/v1/rpc/post_manual_payment",
  { method: "POST", body: JSON.stringify(paymentBody) },
  staffToken,
);
assert(firstPayment?.id && replayPayment?.id === firstPayment.id, "Insurance payment replay did not return the same payment.");
assert(replayPayment?.idempotent_replay === true, "Insurance payment replay was not identified as idempotent.");

const payments = await rows(
  "payments",
  'idempotency_key=eq.e2e-insured-payment-001&select=id,payment_source,payment_method,payment_status,amount_cents,payer_id,client_id',
);
assert(payments.length === 1, "Idempotent insured payment created more than one payment row.");
const payment = payments[0];
assert(payment.payment_source === "insurance", "Synthetic payment source is not insurance.");
assert(payment.payment_method === "eft", "Synthetic payment method is not EFT.");
assert(payment.payment_status === "posted", "Synthetic insurance payment is not posted.");
assert(Number(payment.amount_cents) === 15000, "Synthetic insurance payment amount is not $150.00.");

const allocations = await rows(
  "payment_allocations",
  `payment_id=eq.${payment.id}&claim_id=eq.${claim.id}&select=id,amount_cents,reversed_at`,
);
assert(allocations.length === 1, "Synthetic insurance payment allocation count is incorrect.");
assert(Number(allocations[0].amount_cents) === 15000 && !allocations[0].reversed_at, "Synthetic insurance allocation is incorrect.");

const summaries = await rows(
  "claim_balance_summaries",
  `claim_id=eq.${claim.id}&select=total_charge_cents,paid_amount_cents,adjustment_amount_cents,open_balance_cents&limit=1`,
);
const summary = summaries[0];
assert(summary, "Claim balance summary was not created.");
assert(Number(summary.total_charge_cents) === 15000, "Claim balance total is incorrect.");
assert(Number(summary.paid_amount_cents) === 15000, "Claim balance paid amount is incorrect.");
assert(Number(summary.open_balance_cents) === 0, "Claim did not reconcile to zero.");

claim = (await rows(
  "professional_claims",
  `id=eq.${claim.id}&select=id,claim_status,paid_at&limit=1`,
))[0];
assert(claim.claim_status === "paid", "Fully allocated accepted claim did not move to paid.");
assert(Boolean(claim.paid_at), "Paid claim timestamp is missing.");

const transactions = await rows(
  "ledger_transactions",
  `source_type=eq.payment_receipt&source_id=eq.${payment.id}&select=id&limit=1`,
);
assert(transactions[0]?.id, "Insurance payment ledger transaction was not created.");

const entries = await rows(
  "ledger_entries",
  `ledger_transaction_id=eq.${transactions[0].id}&select=side,amount_cents,claim_id,payer_id`,
);
const debit = entries.filter((row) => row.side === "debit").reduce((sum, row) => sum + Number(row.amount_cents), 0);
const credit = entries.filter((row) => row.side === "credit").reduce((sum, row) => sum + Number(row.amount_cents), 0);
assert(debit === 15000 && credit === 15000, "Insurance payment ledger transaction is not balanced.");
assert(entries.some((row) => row.side === "credit" && row.claim_id === claim.id), "Insurance payment did not credit claim A/R.");

console.log("Synthetic insured revenue cycle verified: visit → claim → immutable 837P → accepted acknowledgement → idempotent insurance payment → paid zero balance.");
