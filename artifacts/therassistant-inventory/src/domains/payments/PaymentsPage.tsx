import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { StatusBadge } from "../../components/status-badge";
import { dateTime, money, shortDate } from "../../lib/format";
import {
  RecoveryReviewDrawer,
  UnderpaymentReviewDrawer,
} from "../ar/ar-work-drawers";
import {
  getArWorkspaceData,
  routeRecoveryToWork,
  routeVarianceToWork,
  type RecoveryWorkspaceRow,
  type VarianceWorkspaceRow,
} from "../ar/repository";
import { allocateExistingPayment } from "./payment-allocation";
import {
  AllocatePaymentDrawer,
  PaymentDetailDrawer,
  PostPaymentDrawer,
  ReversePaymentDrawer,
  type PaymentForm,
  type PaymentRow,
} from "./payment-work-drawers";
import {
  createDenialFromAdjudication,
  getPaymentsWorkspaceData,
  postDemoEra,
  postManualPayment,
  reversePayment,
} from "./repository";

type Data = Awaited<ReturnType<typeof getPaymentsWorkspaceData>>;
type ExceptionData = Awaited<ReturnType<typeof getArWorkspaceData>>;
type Tab = "insurance" | "patient" | "era" | "unapplied" | "adjustments" | "underpayments" | "recovery";

const toCents = (value: string) => Math.round(Number(value || 0) * 100);

export function PaymentsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [exceptionData, setExceptionData] = useState<ExceptionData | null>(null);
  const [tab, setTab] = useState<Tab>("era");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [paymentDetail, setPaymentDetail] = useState<PaymentRow | null>(null);
  const [allocating, setAllocating] = useState<PaymentRow | null>(null);
  const [reversing, setReversing] = useState<PaymentRow | null>(null);
  const [varianceWork, setVarianceWork] = useState<VarianceWorkspaceRow | null>(null);
  const [recoveryWork, setRecoveryWork] = useState<RecoveryWorkspaceRow | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [payments, exceptions] = await Promise.all([
        getPaymentsWorkspaceData(),
        getArWorkspaceData(),
      ]);
      setData(payments);
      setExceptionData(exceptions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load payments workspace.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const acceptedClaims = useMemo(
    () => (data?.claims ?? []).filter((claim) => claim.claim_status === "accepted"),
    [data],
  );
  const unappliedPayments = useMemo(
    () => (data?.payments ?? []).filter((payment) => ["unapplied", "partially_applied"].includes(String(payment.payment_status))),
    [data],
  );
  const insurancePayments = useMemo(
    () => (data?.payments ?? []).filter((payment) => payment.payment_source === "insurance"),
    [data],
  );
  const patientPayments = useMemo(
    () => (data?.payments ?? []).filter((payment) => payment.payment_source === "patient"),
    [data],
  );
  const paymentQueue = tab === "insurance"
    ? insurancePayments
    : tab === "patient"
      ? patientPayments
      : tab === "unapplied"
        ? unappliedPayments
        : [];
  const paymentDetailIndex = paymentDetail ? paymentQueue.findIndex((row) => row.id === paymentDetail.id) : -1;

  function selectTab(nextTab: Tab) {
    setTab(nextTab);
    setPaymentDetail(null);
    setAllocating(null);
  }

  function openPaymentAt(index: number) {
    const row = paymentQueue[index];
    if (row) setPaymentDetail(row);
  }

  async function runPaidEra(claimId: string, totalChargeCents: number) {
    const paidAmountCents = Math.round(totalChargeCents * 0.8);
    const adjustmentAmountCents = totalChargeCents - paidAmountCents;
    setSavingId(claimId);
    setError(null);
    setMessage(null);
    try {
      const result = await postDemoEra({
        claimId,
        paidAmountCents,
        adjustmentAmountCents,
        traceNumber: `DEMO-EFT-${Date.now().toString().slice(-8)}`,
        carcCode: "45",
      });
      if (!result.ok) {
        setError(result.details?.length ? `${result.message} ${result.details.join(" ")}` : result.message);
        return;
      }
      setMessage(`ERA posted. Claim status: ${result.value.claimStatus.replaceAll("_", " ")}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to post demo ERA.");
    } finally {
      setSavingId(null);
    }
  }

  async function runDenied(claimId: string, totalChargeCents: number) {
    setSavingId(claimId);
    setError(null);
    setMessage(null);
    try {
      const result = await createDenialFromAdjudication({
        claimId,
        amountCents: totalChargeCents,
        carcCode: "197",
        rarcCode: "N130",
        category: "authorization",
        reason: "Authorization required for service. Synthetic demo denial.",
        workability: "workable",
      });
      if (!result.ok) {
        setError(result.details?.length ? `${result.message} ${result.details.join(" ")}` : result.message);
        return;
      }
      setMessage("Denial recorded and routed to Denials for follow-up.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create denial.");
    } finally {
      setSavingId(null);
    }
  }

  async function saveManual(source: "insurance" | "patient", form: PaymentForm) {
    setSavingId("new-payment");
    setError(null);
    setMessage(null);
    try {
      const selectedClaim = data?.claims.find((row) => row.id === form.claimId);
      await postManualPayment({
        amountCents: toCents(form.amount),
        source,
        method: form.method,
        clientId: form.clientId || String(selectedClaim?.client_id ?? ""),
        payerId: form.payerId || String(selectedClaim?.payer_id ?? ""),
        claimId: form.claimId || undefined,
        allocationCents: form.claimId ? toCents(form.allocation || form.amount) : 0,
        traceNumber: form.trace,
        checkNumber: form.check,
        notes: form.notes,
      });
      setMessage(`${source === "insurance" ? "Insurance" : "Patient"} payment saved.`);
      setPosting(false);
      setTab(source);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save payment.");
    } finally {
      setSavingId(null);
    }
  }

  async function runAllocate(row: PaymentRow, claimId: string, amount: string) {
    setSavingId(`allocate-${row.id}`);
    setError(null);
    setMessage(null);
    try {
      const result = await allocateExistingPayment(row.id, claimId, toCents(amount));
      setMessage(`Applied ${money(result.amountCents)}. ${money(result.unappliedCents)} remains unapplied.`);
      setAllocating(null);
      setPaymentDetail(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to allocate payment.");
    } finally {
      setSavingId(null);
    }
  }

  async function runReverse(row: PaymentRow, reason: string) {
    setSavingId(row.id);
    setError(null);
    setMessage(null);
    try {
      await reversePayment(row.id, reason);
      setMessage("Payment reversed. Original payment and allocation history were preserved.");
      setReversing(null);
      setPaymentDetail(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to reverse payment.");
    } finally {
      setSavingId(null);
    }
  }

  async function runExceptionAction(label: string, action: () => Promise<unknown>, after?: () => void) {
    setSavingId("payment-exception");
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(label);
      after?.();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to complete payment exception action.");
    } finally {
      setSavingId(null);
    }
  }

  return <>
    <div className="thera-page-header split">
      <div>
        <div className="thera-eyebrow">PAYMENTS / ERA</div>
        <h1>Payments</h1>
        <p>Post and allocate payments, manage unapplied funds and reversals, and work payer payment variances and recovery activity.</p>
      </div>
      <button type="button" className="thera-action" onClick={() => setPosting(true)}>+ Post Payment</button>
    </div>

    <div className="thera-tabs" style={{ marginBottom: 16 }}>
      <TabButton active={tab === "insurance"} onClick={() => selectTab("insurance")} label={`Insurance Payments (${insurancePayments.length})`} />
      <TabButton active={tab === "patient"} onClick={() => selectTab("patient")} label={`Patient Payments (${patientPayments.length})`} />
      <TabButton active={tab === "era"} onClick={() => selectTab("era")} label={`ERA / 835 (${data?.eraFiles.length ?? 0})`} />
      <TabButton active={tab === "unapplied"} onClick={() => selectTab("unapplied")} label={`Unapplied (${unappliedPayments.length})`} />
      <TabButton active={tab === "adjustments"} onClick={() => selectTab("adjustments")} label={`Adjustments / Reversals (${(data?.adjustments.length ?? 0) + (data?.reversals.length ?? 0)})`} />
      <TabButton active={tab === "underpayments"} onClick={() => selectTab("underpayments")} label={`Underpayments (${exceptionData?.variances.length ?? 0})`} />
      <TabButton active={tab === "recovery"} onClick={() => selectTab("recovery")} label={`Recoupments / Refunds (${exceptionData?.recovery.length ?? 0})`} />
    </div>

    {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
    {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}
    {loading && <div className="thera-state">Loading payments...</div>}

    {!loading && data && tab === "insurance" && <PaymentsTable rows={insurancePayments} onOpen={setPaymentDetail} />}
    {!loading && data && tab === "patient" && <PaymentsTable rows={patientPayments} onOpen={setPaymentDetail} />}
    {!loading && data && tab === "era" && <EraTab data={data} acceptedClaims={acceptedClaims} savingId={savingId} onPaid={runPaidEra} onDenied={runDenied} />}
    {!loading && data && tab === "unapplied" && <PaymentsTable rows={unappliedPayments} onOpen={setPaymentDetail} />}
    {!loading && data && tab === "adjustments" && <AdjustmentsTab data={data} />}
    {!loading && exceptionData && tab === "underpayments" && <UnderpaymentsTable rows={exceptionData.variances} onOpen={setVarianceWork} />}
    {!loading && exceptionData && tab === "recovery" && <RecoveryTable rows={exceptionData.recovery} onOpen={setRecoveryWork} />}

    {data && <PostPaymentDrawer open={posting} onOpenChange={setPosting} data={data} saving={savingId === "new-payment"} onSave={saveManual} />}
    {data && <PaymentDetailDrawer
      open={Boolean(paymentDetail)}
      onOpenChange={(open) => { if (!open) setPaymentDetail(null); }}
      row={paymentDetail}
      data={data}
      onAllocate={(row) => { setAllocating(row); setPaymentDetail(null); }}
      onReverse={(row) => { setReversing(row); setPaymentDetail(null); }}
      queuePosition={paymentDetailIndex >= 0 ? `${paymentDetailIndex + 1} of ${paymentQueue.length}` : undefined}
      onPrevious={() => openPaymentAt(paymentDetailIndex - 1)}
      onNext={() => openPaymentAt(paymentDetailIndex + 1)}
      previousDisabled={paymentDetailIndex <= 0}
      nextDisabled={paymentDetailIndex < 0 || paymentDetailIndex >= paymentQueue.length - 1}
    />}
    {data && <AllocatePaymentDrawer open={Boolean(allocating)} onOpenChange={(open) => { if (!open) setAllocating(null); }} row={allocating} data={data} saving={Boolean(allocating && savingId === `allocate-${allocating.id}`)} onSave={runAllocate} />}
    <ReversePaymentDrawer open={Boolean(reversing)} onOpenChange={(open) => { if (!open) setReversing(null); }} row={reversing} saving={Boolean(reversing && savingId === reversing.id)} onSave={runReverse} />
    <UnderpaymentReviewDrawer
      open={Boolean(varianceWork)}
      onOpenChange={(open) => { if (!open) setVarianceWork(null); }}
      row={varianceWork}
      saving={savingId === "payment-exception"}
      onRoute={(row) => void runExceptionAction("Underpayment follow-up created.", () => routeVarianceToWork(row), () => setVarianceWork(null))}
    />
    <RecoveryReviewDrawer
      open={Boolean(recoveryWork)}
      onOpenChange={(open) => { if (!open) setRecoveryWork(null); }}
      row={recoveryWork}
      saving={savingId === "payment-exception"}
      onRoute={(row) => void runExceptionAction("Recovery follow-up created.", () => routeRecoveryToWork(row), () => setRecoveryWork(null))}
    />
  </>;
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button type="button" className={active ? "thera-tab active" : "thera-tab"} onClick={onClick}>{label}</button>;
}

function PaymentsTable({ rows, onOpen }: { rows: Data["payments"]; onOpen: (row: PaymentRow) => void }) {
  return <section className="thera-card">{rows.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Date</th><th>Patient</th><th>Payer</th><th>Source</th><th>Method</th><th>Trace</th><th>Amount</th><th>Allocated</th><th>Unapplied</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} onClick={() => onOpen(row)} style={{ cursor: "pointer" }}><td>{shortDate(String(row.payment_date ?? ""))}</td><td>{row.clientName}</td><td>{row.payerName}</td><td>{String(row.payment_source || "—")}</td><td>{String(row.payment_method || "—")}</td><td>{String(row.trace_number || row.check_number || "—")}</td><td>{money(Number(row.amount_cents ?? 0))}</td><td>{money(row.allocatedCents)}</td><td>{money(row.unappliedCents)}</td><td><StatusBadge value={String(row.payment_status)} /></td><td><button type="button" className="thera-action secondary" onClick={(e) => { e.stopPropagation(); onOpen(row); }}>Open</button></td></tr>)}</tbody></table></div> : <div className="thera-empty">No payments in this section.</div>}</section>;
}

function EraTab({ data, acceptedClaims, savingId, onPaid, onDenied }: { data: Data; acceptedClaims: Data["claims"]; savingId: string | null; onPaid: (claimId: string, totalChargeCents: number) => Promise<void>; onDenied: (claimId: string, totalChargeCents: number) => Promise<void> }) {
  return <div className="thera-stack">
    <section className="thera-card">
      <div className="thera-card-header"><div><h2>Accepted Claims Awaiting Adjudication</h2><p>Use synthetic payer outcomes to demonstrate ERA/payment or denial processing.</p></div></div>
      {acceptedClaims.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Claim</th><th>DOS</th><th>Patient</th><th>Payer</th><th>Charge</th><th>Status</th><th>Demo Adjudication</th></tr></thead><tbody>{acceptedClaims.map((claim) => <tr key={claim.id}><td><Link className="thera-table-link" href={`/claims/${claim.id}`}>{String(claim.patient_control_number || "Open")}</Link></td><td>{shortDate(String(claim.service_date_from ?? ""))}</td><td>{claim.clientName}</td><td>{claim.payerName}</td><td>{money(Number(claim.total_charge_cents ?? 0))}</td><td><StatusBadge value={String(claim.claim_status)} /></td><td><div className="thera-filter-row"><button type="button" className="thera-action" disabled={savingId === claim.id} onClick={() => void onPaid(claim.id, Number(claim.total_charge_cents ?? 0))}>Post Paid ERA</button><button type="button" className="thera-action secondary" disabled={savingId === claim.id} onClick={() => void onDenied(claim.id, Number(claim.total_charge_cents ?? 0))}>Demo Denied</button></div></td></tr>)}</tbody></table></div> : <div className="thera-empty">No accepted claims are awaiting adjudication.</div>}
    </section>
    <section className="thera-card">
      <h2>ERA / 835 History</h2>
      {data.eraFiles.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Created</th><th>File</th><th>Trace</th><th>Payment</th><th>Status</th></tr></thead><tbody>{data.eraFiles.map((row) => <tr key={row.id}><td>{dateTime(String(row.created_at ?? ""))}</td><td>{String(row.file_name || "—")}</td><td>{String(row.check_or_trace_number || "—")}</td><td>{money(Number(row.payment_amount_cents ?? 0))}</td><td><StatusBadge value={String(row.status)} /></td></tr>)}</tbody></table></div> : <div className="thera-empty">No ERA files posted yet.</div>}
    </section>
  </div>;
}

function AdjustmentsTab({ data }: { data: Data }) {
  return <div className="thera-stack">
    <section className="thera-card">
      <div className="thera-card-header"><div><h2>Adjustments</h2><p>Posted contractual, write-off, recoupment, refund-correction, and balance-correction history.</p></div></div>
      {data.adjustments.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Date</th><th>Patient</th><th>Claim</th><th>Payer</th><th>Type</th><th>Amount</th><th>Status</th><th>Reason</th></tr></thead><tbody>{data.adjustments.map((row) => <tr key={row.id}><td>{shortDate(String(row.adjustment_date ?? ""))}</td><td>{row.patientName}</td><td>{row.claim_id ? <Link className="thera-table-link" href={`/claims/${row.claim_id}`}>{row.claimControlNumber}</Link> : "—"}</td><td>{row.payerName}</td><td>{String(row.adjustment_type ?? "—").replaceAll("_", " ")}</td><td>{money(Number(row.amount_cents ?? 0))}</td><td><StatusBadge value={String(row.adjustment_status ?? "pending")} /></td><td>{String(row.reason ?? "—")}</td></tr>)}</tbody></table></div> : <div className="thera-empty">No adjustments.</div>}
    </section>
    <section className="thera-card">
      <div className="thera-card-header"><div><h2>Payment Reversals</h2><p>Reversals preserve the original payment and allocation history.</p></div></div>
      {data.reversals.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Created</th><th>Patient</th><th>Trace</th><th>Original Amount</th><th>Reason</th></tr></thead><tbody>{data.reversals.map((row) => <tr key={row.id}><td>{dateTime(String(row.created_at ?? ""))}</td><td>{row.patientName}</td><td>{row.traceNumber}</td><td>{money(row.amountCents)}</td><td>{String(row.reason ?? "—")}</td></tr>)}</tbody></table></div> : <div className="thera-empty">No payment reversals.</div>}
    </section>
  </div>;
}

function UnderpaymentsTable({ rows, onOpen }: { rows: VarianceWorkspaceRow[]; onOpen: (row: VarianceWorkspaceRow) => void }) {
  if (!rows.length) return <section className="thera-card"><div className="thera-empty">No contract underpayments are currently identified.</div></section>;
  const totalVariance = rows.reduce((sum, row) => sum + row.varianceCents, 0);
  return <div className="thera-stack">
    <section className="thera-card"><div className="thera-metric-grid"><div className="thera-metric-card"><div className="thera-metric-label">Underpaid Claims</div><div className="thera-metric-value">{rows.length}</div></div><div className="thera-metric-card"><div className="thera-metric-label">Recoverable Variance</div><div className="thera-metric-value">{money(totalVariance)}</div></div></div></section>
    <section className="thera-card"><div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Claim / Patient</th><th>DOS</th><th>Payer</th><th>Provider</th><th>Expected Allowed</th><th>Actual Allowed</th><th>Underpayment</th><th>Work</th><th>Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.claimNumber}<div className="thera-table-subtext">{row.clientName}</div></td><td>{shortDate(row.serviceDate)}</td><td>{row.payerName}</td><td>{row.providerName}</td><td>{money(row.expectedAllowedCents)}</td><td>{money(row.actualAllowedCents)}</td><td>{money(row.varianceCents)}</td><td>{row.workStatus}</td><td><button type="button" className="thera-action secondary" onClick={() => onOpen(row)}>Review</button></td></tr>)}</tbody></table></div></section>
  </div>;
}

function RecoveryTable({ rows, onOpen }: { rows: RecoveryWorkspaceRow[]; onOpen: (row: RecoveryWorkspaceRow) => void }) {
  if (!rows.length) return <section className="thera-card"><div className="thera-empty">No active recoupment or refund corrections.</div></section>;
  return <section className="thera-card"><div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Claim / Patient</th><th>Payer</th><th>Type</th><th>Amount</th><th>Status</th><th>Work</th><th>Reason</th><th>Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.claimNumber}<div className="thera-table-subtext">{row.clientName}</div></td><td>{row.payerName}</td><td>{String(row.adjustment_type ?? "recovery").replaceAll("_", " ")}</td><td>{money(Number(row.amount_cents ?? 0))}</td><td><StatusBadge value={String(row.adjustment_status ?? "pending")} /></td><td>{row.workStatus}</td><td>{String(row.reason ?? "—")}</td><td><button type="button" className="thera-action secondary" onClick={() => onOpen(row)}>Review</button></td></tr>)}</tbody></table></div></section>;
}
