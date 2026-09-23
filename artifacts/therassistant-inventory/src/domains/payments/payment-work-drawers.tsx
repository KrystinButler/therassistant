import { useEffect, useMemo, useState } from "react";
import { WorkDrawer } from "../../components/work-drawer";
import { StatusBadge } from "../../components/status-badge";
import { dateTime, money, shortDate } from "../../lib/format";
import type { getPaymentsWorkspaceData } from "./repository";

type Data = Awaited<ReturnType<typeof getPaymentsWorkspaceData>>;
export type PaymentForm = { amount: string; method: string; claimId: string; allocation: string; clientId: string; payerId: string; trace: string; check: string; notes: string };
export const blankPaymentForm: PaymentForm = { amount: "", method: "manual", claimId: "", allocation: "", clientId: "", payerId: "", trace: "", check: "", notes: "" };
export type PaymentRow = Data["payments"][number];
function value(input: unknown, fallback = "—") { return input == null || input === "" ? fallback : String(input); }
function Fact({ label, children }: { label: string; children: React.ReactNode }) { return <div><div className="thera-table-subtext">{label}</div><strong>{children}</strong></div>; }

export function PostPaymentDrawer({ open, onOpenChange, data, saving, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; data: Data; saving: boolean; onSave: (source: "insurance" | "patient", form: PaymentForm) => Promise<void> | void }) {
  const [source, setSource] = useState<"insurance" | "patient">("insurance"); const [form, setForm] = useState<PaymentForm>(blankPaymentForm);
  useEffect(() => { if (open) { setSource("insurance"); setForm(blankPaymentForm); } }, [open]);
  const dirty = useMemo(() => source !== "insurance" || JSON.stringify(form) !== JSON.stringify(blankPaymentForm), [source, form]);
  const selectedClaim = data.claims.find((row) => row.id === form.claimId);
  const footer = <div className="thera-filter-row" style={{ justifyContent: "space-between" }}><button type="button" className="thera-action secondary" onClick={() => onOpenChange(false)}>Cancel</button><button type="button" className="thera-action" disabled={saving || Number(form.amount) <= 0} onClick={() => void onSave(source, form)}>{saving ? "Posting..." : "Post Payment"}</button></div>;
  return <WorkDrawer open={open} onOpenChange={onOpenChange} dirty={dirty} title="Post Payment" subtitle="Record and allocate a payment without leaving the payment workspace." footer={footer}>
    <div className="thera-form-grid">
      <label>Payment source<select className="thera-input" value={source} onChange={(e) => setSource(e.target.value as "insurance" | "patient")}><option value="insurance">Insurance payment</option><option value="patient">Patient payment</option></select></label>
      <label>Amount<input className="thera-input" type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm((v) => ({ ...v, amount: e.target.value }))} /></label>
      <label>Payment method<select className="thera-input" value={form.method} onChange={(e) => setForm((v) => ({ ...v, method: e.target.value }))}><option value="manual">Manual</option><option value="eft">EFT</option><option value="ach">ACH</option><option value="check">Check</option><option value="credit_card">Credit card</option><option value="debit_card">Debit card</option><option value="cash">Cash</option><option value="portal">Portal</option></select></label>
      {source === "patient" ? <label>Patient<select className="thera-input" value={form.clientId} onChange={(e) => setForm((v) => ({ ...v, clientId: e.target.value }))}><option value="">Select patient</option>{data.clients.map((row) => <option key={row.id} value={row.id}>{[row.first_name, row.last_name].filter(Boolean).join(" ")}</option>)}</select></label> : <label>Payer<select className="thera-input" value={form.payerId} onChange={(e) => setForm((v) => ({ ...v, payerId: e.target.value }))}><option value="">Payer from claim</option>{data.payers.map((row) => <option key={row.id} value={row.id}>{String(row.name ?? "Payer")}</option>)}</select></label>}
      <label>{source === "patient" ? "Patient balance / claim allocation" : "Initial claim allocation"}<select className="thera-input" value={form.claimId} onChange={(e) => setForm((v) => ({ ...v, claimId: e.target.value }))}><option value="">{source === "patient" ? "Apply to patient balance" : "Leave unapplied"}</option>{data.claims.filter((row) => !["voided", "reversed", "paid"].includes(String(row.claim_status))).map((row) => <option key={row.id} value={row.id}>{String(row.patient_control_number ?? "Claim")} · {row.clientName}</option>)}</select></label>
      <label>Allocation amount<input className="thera-input" type="number" min="0" step="0.01" value={form.allocation} placeholder={form.claimId || (source === "patient" && form.clientId) ? form.amount || "0.00" : "Unapplied"} disabled={!form.claimId && !(source === "patient" && form.clientId)} onChange={(e) => setForm((v) => ({ ...v, allocation: e.target.value }))} /></label>
      <label>Trace number<input className="thera-input" value={form.trace} onChange={(e) => setForm((v) => ({ ...v, trace: e.target.value }))} /></label><label>Check number<input className="thera-input" value={form.check} onChange={(e) => setForm((v) => ({ ...v, check: e.target.value }))} /></label>
      <label style={{ gridColumn: "1 / -1" }}>Notes<textarea className="thera-input" rows={5} value={form.notes} onChange={(e) => setForm((v) => ({ ...v, notes: e.target.value }))} /></label>
    </div>
    {selectedClaim && <section className="thera-card"><h2>Selected claim</h2><div className="thera-form-grid"><Fact label="Patient">{selectedClaim.clientName}</Fact><Fact label="Payer">{selectedClaim.payerName}</Fact><Fact label="Claim">{value(selectedClaim.patient_control_number)}</Fact><Fact label="Charge">{money(Number(selectedClaim.total_charge_cents ?? 0))}</Fact></div></section>}
    <div className="thera-alert" style={{ marginTop: 16 }}>Patient payments without a selected claim apply to the patient’s open balance, including self-pay charges. If a payment covers multiple insurance claims, post it and use Apply Payment for any remaining unapplied amount.</div>
  </WorkDrawer>;
}

export function PaymentDetailDrawer({
  open,
  onOpenChange,
  row,
  data,
  onReverse,
  onAllocate,
  queuePosition,
  onPrevious,
  onNext,
  previousDisabled,
  nextDisabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: PaymentRow | null;
  data: Data;
  onReverse: (row: PaymentRow) => void;
  onAllocate: (row: PaymentRow) => void;
  queuePosition?: string;
  onPrevious?: () => void;
  onNext?: () => void;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
}) {
  if (!row) return null; const allocations = data.allocations.filter((item) => item.payment_id === row.id); const reversals = data.reversals.filter((item) => item.payment_id === row.id); const claimIds = new Set(allocations.map((item) => String(item.claim_id ?? ""))); const adjustments = data.adjustments.filter((item) => claimIds.has(String(item.claim_id ?? "")));
  const canAllocate = row.unappliedCents > 0 && !["reversed", "voided"].includes(String(row.payment_status));
  const footer = <div className="thera-filter-row" style={{ justifyContent: "space-between" }}><button type="button" className="thera-action secondary" onClick={() => onOpenChange(false)}>Close</button><div className="thera-filter-row">{canAllocate && <button type="button" className="thera-action" onClick={() => onAllocate(row)}>Apply Payment</button>}{!["reversed", "voided"].includes(String(row.payment_status)) && <button type="button" className="thera-action secondary" onClick={() => onReverse(row)}>Reverse Payment</button>}</div></div>;
  return <WorkDrawer open={open} onOpenChange={onOpenChange} title={`${money(Number(row.amount_cents ?? 0))} payment`} subtitle={`${row.clientName} · ${row.payerName}`} badges={<StatusBadge value={String(row.payment_status)} />} queuePosition={queuePosition} onPrevious={onPrevious} onNext={onNext} previousDisabled={previousDisabled} nextDisabled={nextDisabled} footer={footer}>
    <div className="thera-form-grid"><Fact label="Payment source">{value(row.payment_source)}</Fact><Fact label="Amount">{money(Number(row.amount_cents ?? 0))}</Fact><Fact label="Allocated amount">{money(row.allocatedCents)}</Fact><Fact label="Unapplied amount">{money(row.unappliedCents)}</Fact><Fact label="Patient">{row.clientName}</Fact><Fact label="Payer">{row.payerName}</Fact><Fact label="Payment method">{value(row.payment_method)}</Fact><Fact label="Trace / check">{value(row.trace_number ?? row.check_number)}</Fact></div>
    <section className="thera-card"><h2>Claim allocations</h2>{allocations.length ? allocations.map((item) => <div key={item.id} className="thera-card"><strong>{item.claimControlNumber}</strong><div>{item.patientName} · {money(Number(item.amount_cents ?? 0))}</div>{Boolean(item.reversed_at) && <div className="thera-table-subtext">Reversed {dateTime(String(item.reversed_at))}</div>}</div>) : <div className="thera-empty">This is currently an unapplied payment.</div>}</section>
    <section className="thera-card"><h2>ERA / 835 information</h2><div className="thera-form-grid"><Fact label="Trace">{value(row.trace_number)}</Fact><Fact label="Check">{value(row.check_number)}</Fact><Fact label="Payment date">{row.payment_date ? shortDate(String(row.payment_date)) : "—"}</Fact></div></section>
    <section className="thera-card"><h2>Adjustment history</h2>{adjustments.length ? adjustments.map((item) => <div key={item.id}>{value(item.adjustment_type)} · {money(Number(item.amount_cents ?? 0))} · {value(item.reason)}</div>) : <div className="thera-empty">No related adjustments.</div>}</section>
    <section className="thera-card"><h2>Reversal history</h2>{reversals.length ? reversals.map((item) => <div key={item.id}>{dateTime(String(item.created_at ?? ""))} · {value(item.reason)}</div>) : <div className="thera-empty">No reversals.</div>}</section>
    <section className="thera-card"><h2>Notes</h2><p>{value(row.notes, "No payment notes recorded.")}</p></section>
  </WorkDrawer>;
}

export function AllocatePaymentDrawer({ open, onOpenChange, row, data, saving, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; row: PaymentRow | null; data: Data; saving: boolean; onSave: (row: PaymentRow, claimId: string, amount: string) => Promise<void> | void }) {
  const [claimId, setClaimId] = useState("");
  const [amount, setAmount] = useState("");
  useEffect(() => {
    if (!open || !row) return;
    setClaimId("");
    setAmount((row.unappliedCents / 100).toFixed(2));
  }, [open, row?.id]);
  if (!row) return null;

  const source = String(row.payment_source ?? "");
  const eligibleClaims = data.claims.filter((claim) => {
    if (["voided", "reversed", "paid"].includes(String(claim.claim_status ?? ""))) return false;
    if (source === "insurance" && row.payer_id && claim.payer_id && String(row.payer_id) !== String(claim.payer_id)) return false;
    if (source === "patient" && row.client_id && claim.client_id && String(row.client_id) !== String(claim.client_id)) return false;
    return true;
  });
  const selectedClaim = eligibleClaims.find((claim) => claim.id === claimId);
  const dirty = Boolean(claimId || amount !== (row.unappliedCents / 100).toFixed(2));
  const footer = <div className="thera-filter-row" style={{ justifyContent: "space-between" }}><button type="button" className="thera-action secondary" onClick={() => onOpenChange(false)}>Cancel</button><button type="button" className="thera-action" disabled={saving || !claimId || Number(amount) <= 0} onClick={() => void onSave(row, claimId, amount)}>{saving ? "Applying..." : "Apply Payment"}</button></div>;

  return <WorkDrawer open={open} onOpenChange={onOpenChange} dirty={dirty} title="Apply Payment" subtitle={`${money(row.unappliedCents)} remains unapplied · ${row.payerName}`} footer={footer}>
    <div className="thera-form-grid">
      <Fact label="Original payment">{money(Number(row.amount_cents ?? 0))}</Fact>
      <Fact label="Already allocated">{money(row.allocatedCents)}</Fact>
      <Fact label="Available to apply">{money(row.unappliedCents)}</Fact>
      <Fact label="Trace / check">{value(row.trace_number ?? row.check_number)}</Fact>
      <label style={{ gridColumn: "1 / -1" }}>Claim<select className="thera-input" value={claimId} onChange={(event) => setClaimId(event.target.value)}><option value="">Select claim</option>{eligibleClaims.map((claim) => <option key={claim.id} value={claim.id}>{String(claim.patient_control_number ?? "Claim")} · {claim.clientName} · {claim.payerName}</option>)}</select></label>
      <label>Allocation amount<input className="thera-input" type="number" min="0.01" step="0.01" max={(row.unappliedCents / 100).toFixed(2)} value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
    </div>
    {selectedClaim && <section className="thera-card"><h2>Selected claim</h2><div className="thera-form-grid"><Fact label="Patient">{selectedClaim.clientName}</Fact><Fact label="Payer">{selectedClaim.payerName}</Fact><Fact label="Claim">{value(selectedClaim.patient_control_number)}</Fact><Fact label="Charge">{money(Number(selectedClaim.total_charge_cents ?? 0))}</Fact><Fact label="Status">{value(selectedClaim.claim_status)}</Fact></div></section>}
  </WorkDrawer>;
}

export function ReversePaymentDrawer({ open, onOpenChange, row, saving, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; row: PaymentRow | null; saving: boolean; onSave: (row: PaymentRow, reason: string) => Promise<void> | void }) {
  const [reason, setReason] = useState(""); useEffect(() => { if (open) setReason(""); }, [open, row?.id]); if (!row) return null;
  return <WorkDrawer open={open} onOpenChange={onOpenChange} dirty={Boolean(reason)} title="Reverse Payment" subtitle={`${money(Number(row.amount_cents ?? 0))} · ${row.clientName}`} footer={<div className="thera-filter-row" style={{ justifyContent: "space-between" }}><button type="button" className="thera-action secondary" onClick={() => onOpenChange(false)}>Cancel</button><button type="button" className="thera-action" disabled={saving || !reason.trim()} onClick={() => void onSave(row, reason)}>Reverse Payment</button></div>}><div className="thera-alert" style={{ marginBottom: 16 }}>The original payment and allocation history will be preserved.</div><label>Reversal reason<textarea className="thera-input" rows={7} value={reason} onChange={(e) => setReason(e.target.value)} /></label></WorkDrawer>;
}
