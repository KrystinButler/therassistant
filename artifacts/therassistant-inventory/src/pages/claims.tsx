import { useState } from "react";
import { Link } from "wouter";
import { ClaimWorkDrawer } from "../domains/claims/claim-work-drawer";
import { StatusBadge } from "../components/status-badge";
import { money, shortDate } from "../lib/format";
import { demoInsert, demoUpdate } from "../lib/demo-data";
import { useApi } from "../lib/therassistant-api";

type ClaimRow = {
  id: string;
  patientControlNumber?: string | null;
  payerClaimNumber?: string | null;
  claimStatus: string;
  serviceDateFrom?: string | null;
  totalChargeCents?: number;
  clientName: string;
  payerName?: string | null;
  renderingProviderName?: string | null;
  billingProviderName?: string | null;
  paidAmountCents?: number;
  adjustmentAmountCents?: number;
  openBalanceCents?: number;
  denialCount?: number;
};

export function ClaimsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [version, setVersion] = useState(0);
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);

  const path = `/api/claims?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}&refresh=${version}`;
  const { data, loading, error } = useApi<ClaimRow[]>(path);
  const claims = data ?? [];
  const selectedIndex = claims.findIndex((claim) => claim.id === selectedClaimId);
  const selectedClaim = selectedIndex >= 0 ? claims[selectedIndex] : null;

  async function updateStatus(id: string, claimStatus: string, extra: Record<string, unknown> = {}) {
    await demoUpdate("professional_claims", id, { claim_status: claimStatus, ...extra });
    setVersion((v) => v + 1);
  }

  async function createFollowUp(claim: ClaimRow) {
    await demoInsert("workqueue_items", {
      workqueue_type: claim.claimStatus === "denied" ? "denial_followup" : "claim_rejection",
      workqueue_status: "open",
      priority: claim.claimStatus === "denied" ? "high" : "normal",
      source_object_type: "claim",
      source_object_id: claim.id,
      title: `${claim.claimStatus === "denied" ? "Denial" : "Claim"} follow-up: ${claim.patientControlNumber || claim.clientName}`,
      description: `${claim.payerName || "Payer"} claim requires operational follow-up.`,
    });
    setVersion((v) => v + 1);
  }

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">CLAIM OPERATIONS</div>
          <h1>Claims Workqueue</h1>
          <p>Submission readiness, payer status, financial balance, denials, and follow-up.</p>
        </div>
        <div className="thera-filter-row">
          <input className="thera-input" placeholder="Search claims..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="thera-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="ready_for_validation">Ready for Validation</option>
            <option value="validation_failed">Validation Failed</option>
            <option value="ready_for_batch">Ready for Batch</option>
            <option value="submitted">Submitted</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="denied">Denied</option>
            <option value="paid">Paid</option>
          </select>
        </div>
      </div>

      <section className="thera-card">
        {loading && <div className="thera-state">Loading claims...</div>}
        {error && <div className="thera-state error">{error}</div>}
        {!loading && !error && <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Claim</th><th>Patient</th><th>DOS</th><th>Payer</th><th>Rendering Provider</th><th>Charge</th><th>Paid</th><th>Balance</th><th>Status</th><th>Denial</th><th>Actions</th></tr></thead><tbody>
          {claims.map((claim) => <tr key={claim.id}>
            <td><button type="button" className="thera-table-link" onClick={() => setSelectedClaimId(claim.id)}>{claim.patientControlNumber || "Open Claim"}</button><div className="thera-table-subtext">{claim.payerClaimNumber || "No payer claim #"}</div></td>
            <td>{claim.clientName}</td>
            <td>{shortDate(claim.serviceDateFrom)}</td>
            <td>{claim.payerName || "—"}</td>
            <td>{claim.renderingProviderName || "—"}</td>
            <td>{money(claim.totalChargeCents)}</td>
            <td>{money(claim.paidAmountCents)}</td>
            <td>{money(claim.openBalanceCents)}</td>
            <td><StatusBadge value={claim.claimStatus} /></td>
            <td>{Number(claim.denialCount ?? 0) > 0 ? <StatusBadge value="denied" /> : "—"}</td>
            <td><div className="thera-filter-row">
              {claim.claimStatus === "ready_for_validation" && <button type="button" className="thera-action" onClick={() => void updateStatus(claim.id, "ready_for_batch")}>Validate</button>}
              {claim.claimStatus === "validation_failed" && <button type="button" className="thera-action secondary" onClick={() => void updateStatus(claim.id, "ready_for_validation")}>Retry Validation</button>}
              {claim.claimStatus === "ready_for_batch" && <button type="button" className="thera-action" onClick={() => void updateStatus(claim.id, "submitted", { submitted_at: new Date().toISOString() })}>Submit</button>}
              {claim.claimStatus === "submitted" && <button type="button" className="thera-action secondary" onClick={() => void updateStatus(claim.id, "accepted", { accepted_at: new Date().toISOString() })}>Mark Accepted</button>}
              {claim.claimStatus === "rejected" && <button type="button" className="thera-action" onClick={() => setSelectedClaimId(claim.id)}>Correct Claim</button>}
              {claim.claimStatus === "denied" && <Link className="thera-action" href="/ar-denials">Work Denial</Link>}
              {['rejected','denied'].includes(claim.claimStatus) && <button type="button" className="thera-action secondary" onClick={() => void createFollowUp(claim)}>Create Follow-Up</button>}
              <button type="button" className="thera-action secondary" onClick={() => setSelectedClaimId(claim.id)}>Work Claim</button>
              <Link className="thera-action secondary" href={`/claims/${claim.id}`}>Open 360</Link>
            </div></td>
          </tr>)}
        </tbody></table></div>}
      </section>

      <ClaimWorkDrawer
        claim={selectedClaim}
        open={Boolean(selectedClaim)}
        onOpenChange={(open) => { if (!open) setSelectedClaimId(null); }}
        queuePosition={selectedClaim ? `${selectedIndex + 1} of ${claims.length}` : undefined}
        onPrevious={selectedIndex > 0 ? () => setSelectedClaimId(claims[selectedIndex - 1].id) : undefined}
        onNext={selectedIndex >= 0 && selectedIndex < claims.length - 1 ? () => setSelectedClaimId(claims[selectedIndex + 1].id) : undefined}
        previousDisabled={selectedIndex <= 0}
        nextDisabled={selectedIndex < 0 || selectedIndex >= claims.length - 1}
      />
    </>
  );
}
