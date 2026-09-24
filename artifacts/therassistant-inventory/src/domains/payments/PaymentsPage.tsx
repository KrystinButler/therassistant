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
  getPaymentsWorkspaceData,
  import835,
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
  const [tab, setTab] = useState<Tab>("insurance");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [manualPaymentRequestKey, setManualPaymentRequestKey] = useState("");
  const [paymentDetail, setPaymentDetail] = useState<PaymentRow | null>(null);
  const [allocating, setAllocating] = useState<PaymentRow | null>(null);
  const [reversing, setReversing] = useState<PaymentRow | null>(null);
  const [varianceWork, setVarianceWork] = useState<VarianceWorkspaceRow | null>(null);
  const [recoveryWork, setRecoveryWork] = useState<RecoveryWorkspaceRow | null>(null);
  const [eraText, setEraText] = useState("");
  const [eraFileName, setEraFileName] = useState("");

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
  const postedTotalCents = useMemo(
    () => (data?.payments ?? []).reduce((sum, payment) => sum + Number(payment.amount_cents ?? 0), 0),
    [data],
  );
  const unappliedTotalCents = useMemo(
    () => unappliedPayments.reduce((sum, payment) => sum + Number(payment.unappliedCents ?? 0), 0),
    [unappliedPayments],
  );
  const underpaymentTotalCents = useMemo(
    () => (exceptionData?.variances ?? []).reduce((sum, row) => sum + Number(row.varianceCents ?? 0), 0),
    [exceptionData],
  );
  const recoveryTotalCents = useMemo(
    () => (exceptionData?.recovery ?? []).reduce((sum, row) => sum + Number(row.amount_cents ?? 0), 0),
    [exceptionData],
  );

  function selectTab(nextTab: Tab) {
    setTab(nextTab);
    setPaymentDetail(null);
    setAllocating(null);
  }

  function openPaymentAt(index: number) {
    const row = paymentQueue[index];
    if (row) setPaymentDetail(row);
  }

  async function runImport835() {
    if (!eraText.trim()) {
      setError("Choose or paste an 835 file before importing.");
      return;
    }
    setSavingId("import-835");
    setError(null);
    setMessage(null);
    try {
      const result = await import835({
        rawText: eraText,
        fileName: eraFileName || "pasted-835.txt",
      });
      if (!result.ok) {
        setError(result.details?.length ? `${result.message} ${result.details.join(" ")}` : result.message);
        return;
      }
      setMessage(
        `835 imported: ${result.value.matchedCount}/${result.value.claimCount} claim(s) matched, ${result.value.postedCount} posted, ${result.value.exceptionCount} exception(s).`,
      );
      setEraText("");
      setEraFileName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to import 835.");
    } finally {
      setSavingId(null);
    }
  }

  async function load835File(file: File | null) {
    if (!file) return;
    setError(null);
    try {
      setEraText(await file.text());
      setEraFileName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to read 835 file.");
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
        allocationCents: form.claimId
          ? toCents(form.allocation || form.amount)
          : source === "patient" && form.clientId
            ? toCents(form.allocation || form.amount)
            : 0,
        traceNumber: form.trace,
        checkNumber: form.check,
        notes: form.notes,
        idempotencyKey: manualPaymentRequestKey,
      });
      setMessage(`${source === "insurance" ? "Insurance" : "Patient"} payment saved.`);
      setPosting(false);
      setManualPaymentRequestKey("");
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
    <div className="thera-page-header split" style={{ alignItems: "center", marginBottom: 14 }}>
      <div>
        <div className="thera-eyebrow">REVENUE CYCLE · PAYMENT POSTING</div>
        <h1>Payment Posting</h1>
        <p>Post, reconcile, and resolve payment activity from one workspace.</p>
      </div>
      <button type="button" className="thera-action" onClick={() => { setManualPaymentRequestKey(globalThis.crypto.randomUUID()); setPosting(true); }}>+ Post Payment</button>
    </div>

    {!loading && data && <div className="thera-metric-grid four" style={{ marginBottom: 14 }}>
      <div className="thera-metric-card"><div className="thera-metric-label">Posted Payments</div><div className="thera-metric-value">{money(postedTotalCents)}</div><div className="thera-muted">{data.payments.length} payment{data.payments.length === 1 ? "" : "s"}</div></div>
      <div className="thera-metric-card"><div className="thera-metric-label">Unapplied</div><div className="thera-metric-value">{money(unappliedTotalCents)}</div><div className="thera-muted">{unappliedPayments.length} item{unappliedPayments.length === 1 ? "" : "s"} to allocate</div></div>
      <div className="thera-metric-card"><div className="thera-metric-label">Underpayments</div><div className="thera-metric-value">{money(underpaymentTotalCents)}</div><div className="thera-muted">{exceptionData?.variances.length ?? 0} variance{(exceptionData?.variances.length ?? 0) === 1 ? "" : "s"}</div></div>
      <div className="thera-metric-card"><div className="thera-metric-label">Recovery / Refund</div><div className="thera-metric-value">{money(recoveryTotalCents)}</div><div className="thera-muted">{exceptionData?.recovery.length ?? 0} open item{(exceptionData?.recovery.length ?? 0) === 1 ? "" : "s"}</div></div>
    </div>}

    <section className="thera-card" style={{ padding: 12, marginBottom: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 8 }}>
        <WorkflowButton active={tab === "insurance"} onClick={() => selectTab("insurance")} label="Insurance" count={insurancePayments.length} />
        <WorkflowButton active={tab === "patient"} onClick={() => selectTab("patient")} label="Patient" count={patientPayments.length} />
        <WorkflowButton active={tab === "era"} onClick={() => selectTab("era")} label="ERA / 835" count={data?.eraFiles.length ?? 0} />
        <WorkflowButton active={tab === "unapplied"} onClick={() => selectTab("unapplied")} label="Unapplied" count={unappliedPayments.length} />
        <WorkflowButton active={tab === "adjustments"} onClick={() => selectTab("adjustments")} label="Adjustments" count={(data?.adjustments.length ?? 0) + (data?.reversals.length ?? 0)} />
        <WorkflowButton active={tab === "underpayments"} onClick={() => selectTab("underpayments")} label="Underpayments" count={exceptionData?.variances.length ?? 0} />
        <WorkflowButton active={tab === "recovery"} onClick={() => selectTab("recovery")} label="Recovery / Refunds" count={exceptionData?.recovery.length ?? 0} />
      </div>
    </section>

    {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
    {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}
    {loading && <div className="thera-state">Loading payments...</div>}

    {!loading && data && tab === "insurance" && <PaymentsTable rows={insurancePayments} onOpen={setPaymentDetail} />}
    {!loading && data && tab === "patient" && <PaymentsTable rows={patientPayments} onOpen={setPaymentDetail} />}
    {!loading && data && tab === "era" && <EraTab
      data={data}
      acceptedClaims={acceptedClaims}
      savingId={savingId}
      eraText={eraText}
      eraFileName={eraFileName}
      onTextChange={setEraText}
      onFileChange={(file) => void load835File(file)}
      onImport={() => void runImport835()}
    />}
    {!loading && data && tab === "unapplied" && <PaymentsTable rows={unappliedPayments} onOpen={setPaymentDetail} />}
    {!loading && data && tab === "adjustments" && <AdjustmentsTab data={data} />}
    {!loading && exceptionData && tab === "underpayments" && <UnderpaymentsTable rows={exceptionData.variances} onOpen={setVarianceWork} />}
    {!loading && exceptionData && tab === "recovery" && <RecoveryTable rows={exceptionData.recovery} onOpen={setRecoveryWork} />}

    {data && <PostPaymentDrawer open={posting} onOpenChange={(open) => { setPosting(open); if (!open) setManualPaymentRequestKey(""); }} data={data} saving={savingId === "new-payment"} onSave={saveManual} />}
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

function WorkflowButton({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    style={{
      border: active ? "1px solid var(--thera-sage-dark)" : "1px solid var(--thera-border)",
      background: active ? "var(--thera-blue-soft)" : "var(--thera-paper)",
      color: "var(--thera-text)",
      borderRadius: 9,
      padding: "10px 11px",
      minHeight: 54,
      textAlign: "left",
      cursor: "pointer",
      boxShadow: active ? "inset 3px 0 0 var(--thera-sage-dark)" : "none",
    }}
  >
    <span style={{ display: "block", fontSize: 11, fontWeight: 750 }}>{label}</span>
    <span className="thera-muted" style={{ display: "block", marginTop: 2, fontSize: 10 }}>{count} item{count === 1 ? "" : "s"}</span>
  </button>;
}

function PaymentsTable({ rows, onOpen }: { rows: Data["payments"]; onOpen: (row: PaymentRow) => void }) {
  return <section className="thera-card">{rows.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Date</th><th>Patient</th><th>Payer</th><th>Source</th><th>Method</th><th>Trace</th><th>Amount</th><th>Allocated</th><th>Unapplied</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} onClick={() => onOpen(row)} style={{ cursor: "pointer" }}><td>{shortDate(String(row.payment_date ?? ""))}</td><td>{row.clientName}</td><td>{row.payerName}</td><td>{String(row.payment_source || "—")}</td><td>{String(row.payment_method || "—")}</td><td>{String(row.trace_number || row.check_number || "—")}</td><td>{money(Number(row.amount_cents ?? 0))}</td><td>{money(row.allocatedCents)}</td><td>{money(row.unappliedCents)}</td><td><StatusBadge value={String(row.payment_status)} /></td><td><button type="button" className="thera-action secondary" onClick={(e) => { e.stopPropagation(); onOpen(row); }}>Open</button></td></tr>)}</tbody></table></div> : <div className="thera-empty">No payments in this section.</div>}</section>;
}

function EraTab({
  data,
  acceptedClaims,
  savingId,
  eraText,
  eraFileName,
  onTextChange,
  onFileChange,
  onImport,
}: {
  data: Data;
  acceptedClaims: Data["claims"];
  savingId: string | null;
  eraText: string;
  eraFileName: string;
  onTextChange: (value: string) => void;
  onFileChange: (file: File | null) => void;
  onImport: () => void;
}) {
  return <div className="thera-stack">
    <section className="thera-card">
      <div className="thera-card-header split">
        <div>
          <h2>Import ERA / 835</h2>
          <p>Upload or paste an X12 835. THERASSISTANT validates and reconciles the remittance before posting financial activity.</p>
        </div>
        <button type="button" className="thera-action" disabled={savingId === "import-835" || !eraText.trim()} onClick={onImport}>
          {savingId === "import-835" ? "Importing..." : "Import 835"}
        </button>
      </div>
      <div className="thera-form-grid">
        <label className="thera-field">
          <span className="thera-field-label">835 File</span>
          <input
            className="thera-input"
            type="file"
            accept=".835,.txt,text/plain,application/octet-stream"
            onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
          />
          {eraFileName && <span className="thera-muted">{eraFileName}</span>}
        </label>
      </div>
      <label className="thera-field" style={{ marginTop: 12 }}>
        <span className="thera-field-label">835 X12 Content</span>
        <textarea
          className="thera-input"
          rows={10}
          value={eraText}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder="Paste the X12 835 here, or choose a file above."
          style={{ fontFamily: "monospace", whiteSpace: "pre-wrap" }}
        />
      </label>
      <div className="thera-muted" style={{ marginTop: 10 }}>
        Auto-posting is limited to uniquely matched, reconciled claims. Unmatched claims, unsupported CAS groups, negative adjustments, PLB activity, charge mismatches, and unreconciled deposits are routed to payment-posting work instead of being silently posted.
      </div>
    </section>

    <section className="thera-card">
      <div className="thera-card-header">
        <div>
          <h2>Accepted Claims Awaiting Remittance</h2>
          <p>These claims have clearinghouse acceptance but no final payer adjudication posted yet.</p>
        </div>
      </div>
      {acceptedClaims.length ? <div className="thera-table-wrap"><table className="thera-table">
        <thead><tr><th>Claim</th><th>DOS</th><th>Patient</th><th>Payer</th><th>Charge</th><th>Status</th></tr></thead>
        <tbody>{acceptedClaims.map((claim) => <tr key={claim.id}>
          <td><Link className="thera-table-link" href={`/claims/${claim.id}`}>{String(claim.patient_control_number || "Open")}</Link></td>
          <td>{shortDate(String(claim.service_date_from ?? ""))}</td>
          <td>{claim.clientName}</td>
          <td>{claim.payerName}</td>
          <td>{money(Number(claim.total_charge_cents ?? 0))}</td>
          <td><StatusBadge value={String(claim.claim_status)} /></td>
        </tr>)}</tbody>
      </table></div> : <div className="thera-empty">No accepted claims are awaiting remittance.</div>}
    </section>

    <section className="thera-card">
      <h2>ERA / 835 History</h2>
      {data.eraFiles.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Created</th><th>File</th><th>Trace</th><th>Payment</th><th>Status</th></tr></thead><tbody>{data.eraFiles.map((row) => <tr key={row.id}><td>{dateTime(String(row.created_at ?? ""))}</td><td>{String(row.file_name || "—")}</td><td>{String(row.check_or_trace_number || "—")}</td><td>{money(Number(row.payment_amount_cents ?? 0))}</td><td><StatusBadge value={String(row.status)} /></td></tr>)}</tbody></table></div> : <div className="thera-empty">No ERA files imported yet.</div>}
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
