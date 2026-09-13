import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { dateTime, money, shortDate } from "../../lib/format";
import {
  applySyntheticClearinghouseResponse,
  createBatch,
  getClaimSubmissionData,
  submitBatch,
  validateClaim,
} from "./repository";

type Data = Awaited<ReturnType<typeof getClaimSubmissionData>>;
type Tab = "validation" | "batch" | "batches" | "submissions" | "rejections";

export function ClaimSubmissionPage() {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>("validation");
  const [selectedClaims, setSelectedClaims] = useState<Set<string>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await getClaimSubmissionData());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load claim submission workspace.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const groups = useMemo(() => {
    const claims = data?.claims ?? [];
    return {
      validation: claims.filter((claim) => ["ready_for_validation", "validation_failed", "corrected"].includes(String(claim.claim_status))),
      batch: claims.filter((claim) => claim.claim_status === "ready_for_batch"),
      rejections: claims.filter((claim) => claim.claim_status === "rejected"),
    };
  }, [data]);

  function toggleClaim(id: string) {
    setSelectedClaims((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runValidate(id: string) {
    setSavingId(id);
    setError(null);
    setMessage(null);
    try {
      const result = await validateClaim(id);
      if (!result.ok) {
        setError(result.details?.length ? `${result.message} ${result.details.join(" ")}` : result.message);
        return;
      }
      setMessage("Claim scrub passed and is ready for batching.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to validate claim.");
    } finally {
      setSavingId(null);
    }
  }

  async function runCreateBatch() {
    const ids = [...selectedClaims];
    if (!ids.length) {
      setError("Select at least one ready claim.");
      return;
    }
    setSavingId("batch");
    setError(null);
    setMessage(null);
    try {
      const result = await createBatch(ids);
      if (!result.ok) {
        setError(result.details?.length ? `${result.message} ${result.details.join(" ")}` : result.message);
        return;
      }
      setSelectedClaims(new Set());
      setMessage(`Batch created with ${result.value.claimCount} claim(s).`);
      setTab("batches");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create batch.");
    } finally {
      setSavingId(null);
    }
  }

  async function runSubmitBatch(batchId: string) {
    setSavingId(batchId);
    setError(null);
    setMessage(null);
    try {
      const result = await submitBatch(batchId);
      if (!result.ok) {
        setError(result.details?.length ? `${result.message} ${result.details.join(" ")}` : result.message);
        return;
      }
      setMessage(`837P demo submission created for ${result.value.claimCount} claim(s).`);
      setTab("submissions");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit batch.");
    } finally {
      setSavingId(null);
    }
  }

  async function runResponse(submissionId: string, outcome: "accepted" | "rejected") {
    setSavingId(submissionId);
    setError(null);
    setMessage(null);
    try {
      const result = await applySyntheticClearinghouseResponse(submissionId, outcome);
      if (!result.ok) {
        setError(result.details?.length ? `${result.message} ${result.details.join(" ")}` : result.message);
        return;
      }
      setMessage(outcome === "accepted" ? "Clearinghouse acceptance recorded." : "Clearinghouse rejection recorded and routed to Work Center.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to apply clearinghouse response.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">CLAIMS / 837P</div>
          <h1>Claim Submission</h1>
          <p>Validate clean claims, create batches, persist 837P demo submissions, and record clearinghouse responses.</p>
        </div>
        <Link className="thera-action secondary" href="/billing">Back to Billing</Link>
      </div>

      <div className="thera-tabs" style={{ marginBottom: 16 }}>
        <TabButton active={tab === "validation"} onClick={() => setTab("validation")} label={`Ready for Validation (${groups.validation.length})`} />
        <TabButton active={tab === "batch"} onClick={() => setTab("batch")} label={`Ready for Batch (${groups.batch.length})`} />
        <TabButton active={tab === "batches"} onClick={() => setTab("batches")} label={`Batches (${data?.batches.length ?? 0})`} />
        <TabButton active={tab === "submissions"} onClick={() => setTab("submissions")} label={`Submissions (${data?.submissions.length ?? 0})`} />
        <TabButton active={tab === "rejections"} onClick={() => setTab("rejections")} label={`Rejections (${groups.rejections.length})`} />
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}
      {loading && <div className="thera-state">Loading claims...</div>}

      {!loading && data && tab === "validation" && (
        <ClaimsTable rows={groups.validation} savingId={savingId} actionLabel="Validate" onAction={(id) => void runValidate(id)} />
      )}

      {!loading && data && tab === "batch" && (
        <section className="thera-card">
          <div className="thera-card-header split">
            <div><h2>Validated Claims</h2><p>Select claims to place into a persisted batch.</p></div>
            <button type="button" className="thera-action" disabled={savingId === "batch" || selectedClaims.size === 0} onClick={() => void runCreateBatch()}>
              Create Batch ({selectedClaims.size})
            </button>
          </div>
          <ClaimSelectionTable rows={groups.batch} selected={selectedClaims} onToggle={toggleClaim} />
        </section>
      )}

      {!loading && data && tab === "batches" && (
        <BatchesTable rows={data.batches} claims={data.claims} savingId={savingId} onSubmit={(id) => void runSubmitBatch(id)} />
      )}

      {!loading && data && tab === "submissions" && (
        <SubmissionsTable rows={data.submissions} savingId={savingId} onResponse={(id, outcome) => void runResponse(id, outcome)} />
      )}

      {!loading && data && tab === "rejections" && (
        <ClaimsTable rows={groups.rejections} savingId={savingId} actionLabel="Open Claim" actionHref />
      )}
    </>
  );
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button type="button" className={active ? "thera-tab active" : "thera-tab"} onClick={onClick}>{label}</button>;
}

function ClaimsTable({
  rows,
  savingId,
  actionLabel,
  onAction,
  actionHref = false,
}: {
  rows: Data["claims"];
  savingId: string | null;
  actionLabel: string;
  onAction?: (id: string) => void;
  actionHref?: boolean;
}) {
  if (!rows.length) return <section className="thera-card"><div className="thera-empty">No claims in this queue.</div></section>;
  return (
    <section className="thera-card">
      <div className="thera-table-wrap">
        <table className="thera-table">
          <thead><tr><th>Claim</th><th>DOS</th><th>Patient</th><th>Provider</th><th>Payer</th><th>Charge</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{rows.map((claim) => <tr key={claim.id}>
            <td><Link className="thera-table-link" href={`/claims/${claim.id}`}>{String(claim.patient_control_number || "Open Claim")}</Link></td>
            <td>{shortDate(String(claim.service_date_from ?? ""))}</td>
            <td>{claim.clientName}</td>
            <td>{claim.providerName}</td>
            <td>{claim.payerName}</td>
            <td>{money(Number(claim.total_charge_cents ?? 0))}</td>
            <td><StatusBadge value={String(claim.claim_status)} /></td>
            <td>{actionHref ? <Link className="thera-action secondary" href={`/claims/${claim.id}`}>{actionLabel}</Link> : <button type="button" className="thera-action" disabled={savingId === claim.id} onClick={() => onAction?.(claim.id)}>{actionLabel}</button>}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

function ClaimSelectionTable({ rows, selected, onToggle }: { rows: Data["claims"]; selected: Set<string>; onToggle: (id: string) => void }) {
  if (!rows.length) return <div className="thera-empty">No validated claims are ready for batching.</div>;
  return <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Select</th><th>Claim</th><th>DOS</th><th>Patient</th><th>Payer</th><th>Charge</th><th>Status</th></tr></thead><tbody>{rows.map((claim) => <tr key={claim.id}><td><input type="checkbox" checked={selected.has(claim.id)} onChange={() => onToggle(claim.id)} /></td><td><Link className="thera-table-link" href={`/claims/${claim.id}`}>{String(claim.patient_control_number || "Open")}</Link></td><td>{shortDate(String(claim.service_date_from ?? ""))}</td><td>{claim.clientName}</td><td>{claim.payerName}</td><td>{money(Number(claim.total_charge_cents ?? 0))}</td><td><StatusBadge value={String(claim.claim_status)} /></td></tr>)}</tbody></table></div>;
}

function BatchesTable({ rows, claims, savingId, onSubmit }: { rows: Data["batches"]; claims: Data["claims"]; savingId: string | null; onSubmit: (id: string) => void }) {
  const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
  if (!rows.length) return <section className="thera-card"><div className="thera-empty">No claim batches have been created.</div></section>;
  return <section className="thera-card"><div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Batch</th><th>Created</th><th>Claims</th><th>Total</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map((batch) => <tr key={batch.id}><td>{String(batch.batch_name || "837P Batch")}</td><td>{dateTime(String(batch.created_at ?? ""))}</td><td>{batch.claimIds.map((id: string) => claimsById.get(id)?.patient_control_number || id).join(", ") || "—"}</td><td>{money(Number(batch.total_charge_cents ?? 0))}</td><td><StatusBadge value={String(batch.batch_status)} /></td><td>{batch.batch_status === "ready" ? <button type="button" className="thera-action" disabled={savingId === batch.id} onClick={() => onSubmit(batch.id)}>Submit 837P</button> : "—"}</td></tr>)}</tbody></table></div></section>;
}

function SubmissionsTable({ rows, savingId, onResponse }: { rows: Data["submissions"]; savingId: string | null; onResponse: (id: string, outcome: "accepted" | "rejected") => void }) {
  if (!rows.length) return <section className="thera-card"><div className="thera-empty">No 837P demo submissions have been created.</div></section>;
  return <section className="thera-card"><div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Submitted</th><th>Method</th><th>Status</th><th>Latest Response</th><th>Demo Clearinghouse</th></tr></thead><tbody>{rows.map((submission) => { const response = submission.responses[0]; const pending = ["submitted", "pending_response", "created", "resubmitted"].includes(String(submission.submission_status)); return <tr key={submission.id}><td>{dateTime(String(submission.submitted_at || submission.created_at || ""))}</td><td>{String(submission.submission_method || "—")}</td><td><StatusBadge value={String(submission.submission_status)} /></td><td>{response ? <><StatusBadge value={String(response.response_status)} /><div className="thera-table-subtext">{String(response.response_code || "")} {String(response.response_message || "")}</div></> : "Awaiting response"}</td><td>{pending ? <div className="thera-filter-row"><button type="button" className="thera-action secondary" disabled={savingId === submission.id} onClick={() => onResponse(submission.id, "accepted")}>Demo Accepted</button><button type="button" className="thera-action secondary" disabled={savingId === submission.id} onClick={() => onResponse(submission.id, "rejected")}>Demo Rejected</button></div> : "—"}</td></tr>; })}</tbody></table></div></section>;
}
