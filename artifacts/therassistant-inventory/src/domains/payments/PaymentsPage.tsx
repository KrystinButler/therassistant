import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { dateTime, money, shortDate } from "../../lib/format";
import {
  createDenialFromAdjudication,
  getPaymentsWorkspaceData,
  postDemoEra,
} from "./repository";

type Data = Awaited<ReturnType<typeof getPaymentsWorkspaceData>>;
type Tab = "era" | "payments" | "allocations" | "unapplied" | "exceptions";

export function PaymentsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>("era");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await getPaymentsWorkspaceData());
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
      setMessage("Denial recorded and routed to Work Center for follow-up.");
      setTab("exceptions");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create denial.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">PAYMENTS / ERA</div>
          <h1>Payments</h1>
          <p>Post payer adjudication, reconcile allocations, and route denials without bypassing accounting controls.</p>
        </div>
        <Link className="thera-action secondary" href="/claims/submission">Claim Submission</Link>
      </div>

      <div className="thera-tabs" style={{ marginBottom: 16 }}>
        <TabButton active={tab === "era"} onClick={() => setTab("era")} label={`ERA / 835 (${data?.eraFiles.length ?? 0})`} />
        <TabButton active={tab === "payments"} onClick={() => setTab("payments")} label={`Insurance Payments (${data?.payments.length ?? 0})`} />
        <TabButton active={tab === "allocations"} onClick={() => setTab("allocations")} label={`Allocations (${data?.allocations.length ?? 0})`} />
        <TabButton active={tab === "unapplied"} onClick={() => setTab("unapplied")} label={`Unapplied (${unappliedPayments.length})`} />
        <TabButton active={tab === "exceptions"} onClick={() => setTab("exceptions")} label={`Exceptions (${data?.denials.length ?? 0})`} />
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}
      {loading && <div className="thera-state">Loading payments...</div>}

      {!loading && data && tab === "era" && <EraTab data={data} acceptedClaims={acceptedClaims} savingId={savingId} onPaid={runPaidEra} onDenied={runDenied} />}
      {!loading && data && tab === "payments" && <PaymentsTable rows={data.payments} />}
      {!loading && data && tab === "allocations" && <AllocationsTable rows={data.allocations} />}
      {!loading && data && tab === "unapplied" && <PaymentsTable rows={unappliedPayments} />}
      {!loading && data && tab === "exceptions" && <DenialsTable rows={data.denials} />}
    </>
  );
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button type="button" className={active ? "thera-tab active" : "thera-tab"} onClick={onClick}>{label}</button>;
}

function EraTab({
  data,
  acceptedClaims,
  savingId,
  onPaid,
  onDenied,
}: {
  data: Data;
  acceptedClaims: Data["claims"];
  savingId: string | null;
  onPaid: (claimId: string, totalChargeCents: number) => Promise<void>;
  onDenied: (claimId: string, totalChargeCents: number) => Promise<void>;
}) {
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

function PaymentsTable({ rows }: { rows: Data["payments"] }) {
  return <section className="thera-card">{rows.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Date</th><th>Patient</th><th>Payer</th><th>Source</th><th>Method</th><th>Trace</th><th>Amount</th><th>Status</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{shortDate(String(row.payment_date ?? ""))}</td><td>{row.clientName}</td><td>{row.payerName}</td><td>{String(row.payment_source || "—")}</td><td>{String(row.payment_method || "—")}</td><td>{String(row.trace_number || "—")}</td><td>{money(Number(row.amount_cents ?? 0))}</td><td><StatusBadge value={String(row.payment_status)} /></td></tr>)}</tbody></table></div> : <div className="thera-empty">No payments in this section.</div>}</section>;
}

function AllocationsTable({ rows }: { rows: Data["allocations"] }) {
  return <section className="thera-card">{rows.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Created</th><th>Patient</th><th>Claim</th><th>Trace</th><th>Allocated</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{dateTime(String(row.created_at ?? ""))}</td><td>{row.patientName}</td><td>{row.claim_id ? <Link className="thera-table-link" href={`/claims/${row.claim_id}`}>{row.claimControlNumber}</Link> : "—"}</td><td>{row.traceNumber}</td><td>{money(Number(row.amount_cents ?? 0))}</td></tr>)}</tbody></table></div> : <div className="thera-empty">No payment allocations.</div>}</section>;
}

function DenialsTable({ rows }: { rows: Data["denials"] }) {
  return <section className="thera-card">{rows.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Date</th><th>Patient</th><th>Claim</th><th>Payer</th><th>CARC / RARC</th><th>Category</th><th>Amount</th><th>Status</th><th>Reason</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{shortDate(String(row.denial_date ?? ""))}</td><td>{row.patientName}</td><td>{row.claim_id ? <Link className="thera-table-link" href={`/claims/${row.claim_id}`}>{row.claimControlNumber}</Link> : "—"}</td><td>{row.payerName}</td><td>{String(row.carc_code || "—")} / {String(row.rarc_code || "—")}</td><td>{String(row.denial_category || "—")}</td><td>{money(Number(row.amount_cents ?? 0))}</td><td><StatusBadge value={String(row.denial_status)} /></td><td>{String(row.reason || "—")}</td></tr>)}</tbody></table></div> : <div className="thera-empty">No payment or denial exceptions.</div>}</section>;
}
