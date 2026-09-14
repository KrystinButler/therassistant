import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { dateTime, money, shortDate } from "../../lib/format";
import {
  createDenialFromAdjudication,
  getPaymentsWorkspaceData,
  postDemoEra,
  postManualPayment,
  reversePayment,
} from "./repository";

type Data = Awaited<ReturnType<typeof getPaymentsWorkspaceData>>;
type Tab = "insurance" | "patient" | "era" | "unapplied" | "adjustments" | "exceptions";

type PaymentForm = {
  amount: string;
  method: string;
  claimId: string;
  allocation: string;
  clientId: string;
  payerId: string;
  trace: string;
  check: string;
  notes: string;
};

const blankForm: PaymentForm = { amount: "", method: "manual", claimId: "", allocation: "", clientId: "", payerId: "", trace: "", check: "", notes: "" };
const toCents = (value: string) => Math.round(Number(value || 0) * 100);

export function PaymentsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>("era");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [form, setForm] = useState<PaymentForm>(blankForm);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try { setData(await getPaymentsWorkspaceData()); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to load payments workspace."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  const acceptedClaims = useMemo(() => (data?.claims ?? []).filter((claim) => claim.claim_status === "accepted"), [data]);
  const unappliedPayments = useMemo(() => (data?.payments ?? []).filter((payment) => ["unapplied", "partially_applied"].includes(String(payment.payment_status))), [data]);
  const insurancePayments = useMemo(() => (data?.payments ?? []).filter((payment) => payment.payment_source === "insurance"), [data]);
  const patientPayments = useMemo(() => (data?.payments ?? []).filter((payment) => payment.payment_source === "patient"), [data]);

  async function runPaidEra(claimId: string, totalChargeCents: number) {
    const paidAmountCents = Math.round(totalChargeCents * 0.8);
    const adjustmentAmountCents = totalChargeCents - paidAmountCents;
    setSavingId(claimId); setError(null); setMessage(null);
    try {
      const result = await postDemoEra({ claimId, paidAmountCents, adjustmentAmountCents, traceNumber: `DEMO-EFT-${Date.now().toString().slice(-8)}`, carcCode: "45" });
      if (!result.ok) { setError(result.details?.length ? `${result.message} ${result.details.join(" ")}` : result.message); return; }
      setMessage(`ERA posted. Claim status: ${result.value.claimStatus.replaceAll("_", " ")}.`);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to post demo ERA."); }
    finally { setSavingId(null); }
  }

  async function runDenied(claimId: string, totalChargeCents: number) {
    setSavingId(claimId); setError(null); setMessage(null);
    try {
      const result = await createDenialFromAdjudication({ claimId, amountCents: totalChargeCents, carcCode: "197", rarcCode: "N130", category: "authorization", reason: "Authorization required for service. Synthetic demo denial.", workability: "workable" });
      if (!result.ok) { setError(result.details?.length ? `${result.message} ${result.details.join(" ")}` : result.message); return; }
      setMessage("Denial recorded and routed to Work Center for follow-up."); setTab("exceptions"); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to create denial."); }
    finally { setSavingId(null); }
  }

  async function saveManual(source: "insurance" | "patient") {
    setSavingId("new-payment"); setError(null); setMessage(null);
    try {
      const selectedClaim = data?.claims.find((row) => row.id === form.claimId);
      await postManualPayment({
        amountCents: toCents(form.amount), source, method: form.method,
        clientId: form.clientId || String(selectedClaim?.client_id ?? ""),
        payerId: form.payerId || String(selectedClaim?.payer_id ?? ""),
        claimId: form.claimId || undefined,
        allocationCents: form.claimId ? toCents(form.allocation || form.amount) : 0,
        traceNumber: form.trace, checkNumber: form.check, notes: form.notes,
      });
      setForm(blankForm); setMessage(`${source === "insurance" ? "Insurance" : "Patient"} payment saved.`); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to save payment."); }
    finally { setSavingId(null); }
  }

  async function runReverse(paymentId: string) {
    const reason = window.prompt("Reversal reason");
    if (!reason) return;
    setSavingId(paymentId); setError(null); setMessage(null);
    try { await reversePayment(paymentId, reason); setMessage("Payment reversed. Original payment and allocation history were preserved."); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to reverse payment."); }
    finally { setSavingId(null); }
  }

  return (
    <>
      <div className="thera-page-header split">
        <div><div className="thera-eyebrow">PAYMENTS / ERA</div><h1>Payments</h1><p>Post payments, allocate funds, manage unapplied money, preserve reversals, and route payer adjudication.</p></div>
        <Link className="thera-action secondary" href="/claims/submission">Claim Submission</Link>
      </div>

      <div className="thera-tabs" style={{ marginBottom: 16 }}>
        <TabButton active={tab === "insurance"} onClick={() => setTab("insurance")} label={`Insurance Payments (${insurancePayments.length})`} />
        <TabButton active={tab === "patient"} onClick={() => setTab("patient")} label={`Patient Payments (${patientPayments.length})`} />
        <TabButton active={tab === "era"} onClick={() => setTab("era")} label={`ERA / 835 (${data?.eraFiles.length ?? 0})`} />
        <TabButton active={tab === "unapplied"} onClick={() => setTab("unapplied")} label={`Unapplied (${unappliedPayments.length})`} />
        <TabButton active={tab === "adjustments"} onClick={() => setTab("adjustments")} label={`Adjustments / Reversals (${(data?.adjustments.length ?? 0) + (data?.reversals.length ?? 0)})`} />
        <TabButton active={tab === "exceptions"} onClick={() => setTab("exceptions")} label={`Denials (${data?.denials.length ?? 0})`} />
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}
      {loading && <div className="thera-state">Loading payments...</div>}

      {!loading && data && tab === "insurance" && <PaymentEntryTab source="insurance" data={data} rows={insurancePayments} form={form} setForm={setForm} saving={savingId === "new-payment"} onSave={() => void saveManual("insurance")} onReverse={(id) => void runReverse(id)} savingId={savingId} />}
      {!loading && data && tab === "patient" && <PaymentEntryTab source="patient" data={data} rows={patientPayments} form={form} setForm={setForm} saving={savingId === "new-payment"} onSave={() => void saveManual("patient")} onReverse={(id) => void runReverse(id)} savingId={savingId} />}
      {!loading && data && tab === "era" && <EraTab data={data} acceptedClaims={acceptedClaims} savingId={savingId} onPaid={runPaidEra} onDenied={runDenied} />}
      {!loading && data && tab === "unapplied" && <PaymentsTable rows={unappliedPayments} onReverse={(id) => void runReverse(id)} savingId={savingId} />}
      {!loading && data && tab === "adjustments" && <AdjustmentsTab data={data} />}
      {!loading && data && tab === "exceptions" && <DenialsTable rows={data.denials} />}
    </>
  );
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) { return <button type="button" className={active ? "thera-tab active" : "thera-tab"} onClick={onClick}>{label}</button>; }

function PaymentEntryTab({ source, data, rows, form, setForm, saving, onSave, onReverse, savingId }: { source: "insurance" | "patient"; data: Data; rows: Data["payments"]; form: PaymentForm; setForm: React.Dispatch<React.SetStateAction<PaymentForm>>; saving: boolean; onSave: () => void; onReverse: (id: string) => void; savingId: string | null }) {
  return <div className="thera-stack">
    <section className="thera-card"><div className="thera-card-header"><div><h2>Enter {source === "insurance" ? "Insurance" : "Patient"} Payment</h2><p>Payment is saved first, allocations second, then status is derived from the remaining unapplied amount.</p></div></div><div className="thera-filter-row">
      <input className="thera-input" placeholder="Amount (e.g. 85.00)" value={form.amount} onChange={(e) => setForm((v) => ({ ...v, amount: e.target.value }))} />
      <select className="thera-input" value={form.method} onChange={(e) => setForm((v) => ({ ...v, method: e.target.value }))}><option value="manual">Manual</option><option value="eft">EFT</option><option value="ach">ACH</option><option value="check">Check</option><option value="credit_card">Credit card</option><option value="debit_card">Debit card</option><option value="cash">Cash</option><option value="portal">Portal</option></select>
      {source === "patient" && <select className="thera-input" value={form.clientId} onChange={(e) => setForm((v) => ({ ...v, clientId: e.target.value }))}><option value="">Select patient</option>{data.clients.map((row) => <option key={row.id} value={row.id}>{[row.first_name, row.last_name].filter(Boolean).join(" ")}</option>)}</select>}
      {source === "insurance" && <select className="thera-input" value={form.payerId} onChange={(e) => setForm((v) => ({ ...v, payerId: e.target.value }))}><option value="">Payer from claim</option>{data.payers.map((row) => <option key={row.id} value={row.id}>{String(row.name ?? "Payer")}</option>)}</select>}
      <select className="thera-input" value={form.claimId} onChange={(e) => setForm((v) => ({ ...v, claimId: e.target.value }))}><option value="">Leave unapplied</option>{data.claims.filter((row) => !["voided", "reversed", "paid"].includes(String(row.claim_status))).map((row) => <option key={row.id} value={row.id}>{String(row.patient_control_number ?? row.id)} · {row.clientName}</option>)}</select>
      <input className="thera-input" placeholder="Allocation amount" value={form.allocation} onChange={(e) => setForm((v) => ({ ...v, allocation: e.target.value }))} />
      <input className="thera-input" placeholder="Trace #" value={form.trace} onChange={(e) => setForm((v) => ({ ...v, trace: e.target.value }))} />
      <input className="thera-input" placeholder="Check #" value={form.check} onChange={(e) => setForm((v) => ({ ...v, check: e.target.value }))} />
      <button type="button" className="thera-action" disabled={saving} onClick={onSave}>{saving ? "Saving..." : "Post Payment"}</button>
    </div></section>
    <PaymentsTable rows={rows} onReverse={onReverse} savingId={savingId} />
  </div>;
}

function EraTab({ data, acceptedClaims, savingId, onPaid, onDenied }: { data: Data; acceptedClaims: Data["claims"]; savingId: string | null; onPaid: (claimId: string, totalChargeCents: number) => Promise<void>; onDenied: (claimId: string, totalChargeCents: number) => Promise<void> }) {
  return <div className="thera-stack"><section className="thera-card"><div className="thera-card-header"><div><h2>Accepted Claims Awaiting Adjudication</h2><p>Use synthetic payer outcomes to demonstrate ERA/payment or denial processing.</p></div></div>{acceptedClaims.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Claim</th><th>DOS</th><th>Patient</th><th>Payer</th><th>Charge</th><th>Status</th><th>Demo Adjudication</th></tr></thead><tbody>{acceptedClaims.map((claim) => <tr key={claim.id}><td><Link className="thera-table-link" href={`/claims/${claim.id}`}>{String(claim.patient_control_number || "Open")}</Link></td><td>{shortDate(String(claim.service_date_from ?? ""))}</td><td>{claim.clientName}</td><td>{claim.payerName}</td><td>{money(Number(claim.total_charge_cents ?? 0))}</td><td><StatusBadge value={String(claim.claim_status)} /></td><td><div className="thera-filter-row"><button type="button" className="thera-action" disabled={savingId === claim.id} onClick={() => void onPaid(claim.id, Number(claim.total_charge_cents ?? 0))}>Post Paid ERA</button><button type="button" className="thera-action secondary" disabled={savingId === claim.id} onClick={() => void onDenied(claim.id, Number(claim.total_charge_cents ?? 0))}>Demo Denied</button></div></td></tr>)}</tbody></table></div> : <div className="thera-empty">No accepted claims are awaiting adjudication.</div>}</section><section className="thera-card"><h2>ERA / 835 History</h2>{data.eraFiles.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Created</th><th>File</th><th>Trace</th><th>Payment</th><th>Status</th></tr></thead><tbody>{data.eraFiles.map((row) => <tr key={row.id}><td>{dateTime(String(row.created_at ?? ""))}</td><td>{String(row.file_name || "—")}</td><td>{String(row.check_or_trace_number || "—")}</td><td>{money(Number(row.payment_amount_cents ?? 0))}</td><td><StatusBadge value={String(row.status)} /></td></tr>)}</tbody></table></div> : <div className="thera-empty">No ERA files posted yet.</div>}</section></div>;
}

function PaymentsTable({ rows, onReverse, savingId }: { rows: Data["payments"]; onReverse: (id: string) => void; savingId: string | null }) {
  return <section className="thera-card">{rows.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Date</th><th>Patient</th><th>Payer</th><th>Source</th><th>Method</th><th>Trace</th><th>Amount</th><th>Allocated</th><th>Unapplied</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{shortDate(String(row.payment_date ?? ""))}</td><td>{row.clientName}</td><td>{row.payerName}</td><td>{String(row.payment_source || "—")}</td><td>{String(row.payment_method || "—")}</td><td>{String(row.trace_number || row.check_number || "—")}</td><td>{money(Number(row.amount_cents ?? 0))}</td><td>{money(row.allocatedCents)}</td><td>{money(row.unappliedCents)}</td><td><StatusBadge value={String(row.payment_status)} /></td><td>{!["reversed", "voided"].includes(String(row.payment_status)) && <button type="button" className="thera-action secondary" disabled={savingId === row.id} onClick={() => onReverse(row.id)}>Reverse</button>}</td></tr>)}</tbody></table></div> : <div className="thera-empty">No payments in this section.</div>}</section>;
}

function AdjustmentsTab({ data }: { data: Data }) {
  return <div className="thera-stack"><section className="thera-card"><div className="thera-card-header"><div><h2>Adjustments</h2><p>Posted contractual, write-off, recoupment, refund-correction, and balance-correction history.</p></div></div>{data.adjustments.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Date</th><th>Patient</th><th>Claim</th><th>Payer</th><th>Type</th><th>Amount</th><th>Status</th><th>Reason</th></tr></thead><tbody>{data.adjustments.map((row) => <tr key={row.id}><td>{shortDate(String(row.adjustment_date ?? ""))}</td><td>{row.patientName}</td><td>{row.claim_id ? <Link className="thera-table-link" href={`/claims/${row.claim_id}`}>{row.claimControlNumber}</Link> : "—"}</td><td>{row.payerName}</td><td>{String(row.adjustment_type ?? "—").replaceAll("_", " ")}</td><td>{money(Number(row.amount_cents ?? 0))}</td><td><StatusBadge value={String(row.adjustment_status ?? "pending")} /></td><td>{String(row.reason ?? "—")}</td></tr>)}</tbody></table></div> : <div className="thera-empty">No adjustments.</div>}</section><section className="thera-card"><div className="thera-card-header"><div><h2>Payment Reversals</h2><p>Reversals preserve the original payment and allocation history.</p></div></div>{data.reversals.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Created</th><th>Patient</th><th>Trace</th><th>Original Amount</th><th>Reason</th></tr></thead><tbody>{data.reversals.map((row) => <tr key={row.id}><td>{dateTime(String(row.created_at ?? ""))}</td><td>{row.patientName}</td><td>{row.traceNumber}</td><td>{money(row.amountCents)}</td><td>{String(row.reason ?? "—")}</td></tr>)}</tbody></table></div> : <div className="thera-empty">No payment reversals.</div>}</section></div>;
}

function DenialsTable({ rows }: { rows: Data["denials"] }) { return <section className="thera-card">{rows.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Date</th><th>Patient</th><th>Claim</th><th>Payer</th><th>CARC / RARC</th><th>Category</th><th>Amount</th><th>Status</th><th>Reason</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{shortDate(String(row.denial_date ?? ""))}</td><td>{row.patientName}</td><td>{row.claim_id ? <Link className="thera-table-link" href={`/claims/${row.claim_id}`}>{row.claimControlNumber}</Link> : "—"}</td><td>{row.payerName}</td><td>{String(row.carc_code || "—")} / {String(row.rarc_code || "—")}</td><td>{String(row.denial_category || "—")}</td><td>{money(Number(row.amount_cents ?? 0))}</td><td><StatusBadge value={String(row.denial_status)} /></td><td>{String(row.reason || "—")}</td></tr>)}</tbody></table></div> : <div className="thera-empty">No denial exceptions.</div>}</section>; }
