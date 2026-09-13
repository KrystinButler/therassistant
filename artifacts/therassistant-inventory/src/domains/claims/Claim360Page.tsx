import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { dateTime, money, shortDate } from "../../lib/format";
import { getClaim360Data } from "./repository";
import { getClaim360RelationshipsData } from "./relationships-repository";

type BaseData = Awaited<ReturnType<typeof getClaim360Data>>;
type RelationshipData = Awaited<ReturnType<typeof getClaim360RelationshipsData>>;
type Data = Omit<BaseData, "submissions" | "workItems"> & Pick<RelationshipData, "submissions" | "workItems">;

type Tab = "overview" | "lines" | "history" | "responses" | "denials" | "work";

export function Claim360Page() {
  const [, params] = useRoute<{ id: string }>("/claims/:id");
  const claimId = params?.id ?? "";
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!claimId) return;
    setLoading(true);
    setError(null);
    void Promise.all([
      getClaim360Data(claimId),
      getClaim360RelationshipsData(claimId),
    ])
      .then(([base, relationships]) => {
        setData({
          ...base,
          submissions: relationships.submissions,
          workItems: relationships.workItems,
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load claim."))
      .finally(() => setLoading(false));
  }, [claimId]);

  if (loading) return <div className="thera-state">Loading Claim 360...</div>;
  if (error || !data) return <div className="thera-state error">{error || "Claim not found."}</div>;

  const claim = data.claim;

  return (
    <>
      <div className="thera-breadcrumb">
        <Link className="thera-link" href="/claims">Claims</Link><span>/</span><span>{String(claim.patient_control_number || "Claim 360")}</span>
      </div>

      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">CLAIM 360</div>
          <h1>{String(claim.patient_control_number || "Professional Claim")}</h1>
          <p>{claim.clientName} · {claim.providerName} · {claim.payerName} · DOS {shortDate(String(claim.service_date_from ?? ""))}</p>
        </div>
        <div className="thera-header-badges">
          <StatusBadge value={String(claim.claim_status)} />
          <span className="thera-kpi-value">{money(Number(claim.total_charge_cents ?? 0))}</span>
        </div>
      </div>

      <div className="thera-tabs" style={{ marginBottom: 16 }}>
        <TabButton active={tab === "overview"} onClick={() => setTab("overview")} label="Overview" />
        <TabButton active={tab === "lines"} onClick={() => setTab("lines")} label={`Lines & Diagnoses (${data.lines.length})`} />
        <TabButton active={tab === "history"} onClick={() => setTab("history")} label={`Status History (${data.history.length})`} />
        <TabButton active={tab === "responses"} onClick={() => setTab("responses")} label={`Submissions / Responses (${data.submissions.length + data.responses.length})`} />
        <TabButton active={tab === "denials"} onClick={() => setTab("denials")} label={`Denials / Appeals (${data.denials.length + data.appeals.length})`} />
        <TabButton active={tab === "work"} onClick={() => setTab("work")} label={`Work (${data.workItems.length})`} />
      </div>

      {tab === "overview" && <Overview data={data} />}
      {tab === "lines" && <Lines data={data} />}
      {tab === "history" && <History rows={data.history} />}
      {tab === "responses" && <Responses data={data} />}
      {tab === "denials" && <Denials data={data} />}
      {tab === "work" && <Work rows={data.workItems} />}
    </>
  );
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button type="button" className={active ? "thera-tab active" : "thera-tab"} onClick={onClick}>{label}</button>;
}

function Overview({ data }: { data: Data }) {
  const claim = data.claim;
  return <div className="thera-detail-grid">
    <section className="thera-card">
      <h2>Claim Context</h2>
      <div className="thera-definition-grid">
        <Field label="Patient" value={claim.clientName} />
        <Field label="Payer" value={claim.payerName} />
        <Field label="Rendering Provider" value={claim.providerName} />
        <Field label="Service Date" value={shortDate(String(claim.service_date_from ?? ""))} />
        <Field label="Charge" value={money(Number(claim.total_charge_cents ?? 0))} />
        <Field label="Status" value={<StatusBadge value={String(claim.claim_status)} />} />
      </div>
    </section>

    <section className="thera-card">
      <h2>Source & External IDs</h2>
      <div className="thera-definition-grid">
        <Field label="Payer Claim #" value={String(claim.payer_claim_number || "—")} />
        <Field label="Clearinghouse ID" value={String(claim.clearinghouse_claim_id || "—")} />
        <Field label="Submitted" value={claim.submitted_at ? dateTime(String(claim.submitted_at)) : "—"} />
        <Field label="Accepted" value={claim.accepted_at ? dateTime(String(claim.accepted_at)) : "—"} />
      </div>
      {data.sourceEncounter && <div style={{ marginTop: 14 }}><Link className="thera-link" href={`/encounters/${data.sourceEncounter.id}`}>Open Source Encounter</Link></div>}
    </section>

    <section className="thera-card thera-span-2">
      <div className="thera-card-header split"><div><h2>Next Step</h2><p>Claims move forward only through the workflow state machine.</p></div><Link className="thera-action" href="/claims/submission">Open Claim Submission</Link></div>
    </section>
  </div>;
}

function Lines({ data }: { data: Data }) {
  return <div className="thera-detail-grid">
    <section className="thera-card thera-span-2">
      <h2>Professional Claim Lines</h2>
      {data.lines.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>DOS</th><th>CPT</th><th>Modifiers</th><th>Dx Pointer</th><th>Units</th><th>Charge</th><th>Paid</th><th>Adjustment</th></tr></thead><tbody>{data.lines.map((line) => <tr key={line.id}><td>{shortDate(String(line.service_date ?? ""))}</td><td>{String(line.cpt_code ?? "—")}</td><td>{[line.modifier1, line.modifier2].filter(Boolean).join(", ") || "—"}</td><td>{String(line.diagnosis_pointer || "—")}</td><td>{String(line.units ?? "—")}</td><td>{money(Number(line.charge_amount_cents ?? 0))}</td><td>{money(Number(line.paid_amount_cents ?? 0))}</td><td>{money(Number(line.adjustment_amount_cents ?? 0))}</td></tr>)}</tbody></table></div> : <div className="thera-empty">No claim lines.</div>}
    </section>

    <section className="thera-card thera-span-2">
      <h2>Diagnoses</h2>
      {data.diagnoses.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Pointer</th><th>Diagnosis</th></tr></thead><tbody>{data.diagnoses.map((diagnosis) => <tr key={diagnosis.id}><td>{String(diagnosis.pointer_order)}</td><td>{String(diagnosis.diagnosis_code)}</td></tr>)}</tbody></table></div> : <div className="thera-empty">No diagnoses.</div>}
    </section>
  </div>;
}

function History({ rows }: { rows: Data["history"] }) {
  return <section className="thera-card">{rows.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>When</th><th>From</th><th>To</th><th>Reason</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{dateTime(String(row.created_at ?? ""))}</td><td>{row.old_status ? <StatusBadge value={String(row.old_status)} /> : "—"}</td><td><StatusBadge value={String(row.new_status)} /></td><td>{String(row.reason || "—")}</td></tr>)}</tbody></table></div> : <div className="thera-empty">No status history.</div>}</section>;
}

function Responses({ data }: { data: Data }) {
  return <div className="thera-detail-grid">
    <section className="thera-card thera-span-2"><h2>Submissions</h2>{data.submissions.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Submitted</th><th>Method</th><th>Status</th></tr></thead><tbody>{data.submissions.map((row) => <tr key={row.id}><td>{dateTime(String(row.submitted_at || row.created_at || ""))}</td><td>{String(row.submission_method || "—")}</td><td><StatusBadge value={String(row.submission_status)} /></td></tr>)}</tbody></table></div> : <div className="thera-empty">No submissions are linked to this claim.</div>}</section>
    <section className="thera-card thera-span-2"><h2>Clearinghouse Responses</h2>{data.responses.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>When</th><th>Status</th><th>Code</th><th>Message</th></tr></thead><tbody>{data.responses.map((row) => <tr key={row.id}><td>{dateTime(String(row.created_at ?? ""))}</td><td><StatusBadge value={String(row.response_status)} /></td><td>{String(row.response_code || "—")}</td><td>{String(row.response_message || "—")}</td></tr>)}</tbody></table></div> : <div className="thera-empty">No clearinghouse responses.</div>}</section>
  </div>;
}

function Denials({ data }: { data: Data }) {
  return <div className="thera-detail-grid">
    <section className="thera-card thera-span-2"><h2>Denials</h2>{data.denials.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Date</th><th>CARC</th><th>RARC</th><th>Category</th><th>Amount</th><th>Status</th><th>Reason</th></tr></thead><tbody>{data.denials.map((row) => <tr key={row.id}><td>{shortDate(String(row.denial_date ?? row.created_at ?? ""))}</td><td>{String(row.carc_code || "—")}</td><td>{String(row.rarc_code || "—")}</td><td>{String(row.denial_category || "—")}</td><td>{money(Number(row.amount_cents ?? 0))}</td><td><StatusBadge value={String(row.denial_status)} /></td><td>{String(row.reason || "—")}</td></tr>)}</tbody></table></div> : <div className="thera-empty">No denials.</div>}</section>
    <section className="thera-card thera-span-2"><h2>Appeals</h2>{data.appeals.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Created</th><th>Status</th><th>Level</th><th>Due</th></tr></thead><tbody>{data.appeals.map((row) => <tr key={row.id}><td>{dateTime(String(row.created_at ?? ""))}</td><td><StatusBadge value={String(row.appeal_status)} /></td><td>{String(row.appeal_level || "—")}</td><td>{shortDate(String(row.due_date || ""))}</td></tr>)}</tbody></table></div> : <div className="thera-empty">No appeals.</div>}</section>
  </div>;
}

function Work({ rows }: { rows: Data["workItems"] }) {
  return <section className="thera-card">{rows.length ? <div className="thera-stack">{rows.map((row) => <div className="thera-work-card" key={row.id}><div className="thera-work-card-top"><strong>{String(row.title || "Claim work")}</strong><div><StatusBadge value={String(row.priority)} /> <StatusBadge value={String(row.workqueue_status)} /></div></div><div>{String(row.description || "")}</div><div className="thera-muted">{String(row.workqueue_type || "")}</div></div>)}</div> : <div className="thera-empty">No linked claim or denial work items.</div>}</section>;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><div className="thera-field-label">{label}</div><div className="thera-field-value">{value}</div></div>;
}
