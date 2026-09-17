import { useEffect, useMemo, useState } from "react";

import { StatusBadge } from "../../components/status-badge";
import { money, shortDate } from "../../lib/format";
import { getClaimsTab, getOperationalHome, type ClaimsTab } from "../rcm/queue-routing";
import { ClaimWorkDrawer, type ClaimWorkRecord } from "./claim-work-drawer";
import { deferClaim, getClaimsQueueData, resumeClaim, type ClaimsQueueRow } from "./claims-queue-repository";

const CLAIM_TABS: ReadonlyArray<[ClaimsTab, string]> = [
  ["no_response", "No Response"],
  ["deferred", "Deferred"],
  ["0_30", "0-30 Days"],
  ["31_60", "31-60 Days"],
  ["61_90", "61-90 Days"],
  ["91_120", "91-120 Days"],
  ["120_plus", "120+ Days"],
];

function asDrawerClaim(row: ClaimsQueueRow): ClaimWorkRecord {
  return {
    id: row.id,
    patientControlNumber: String(row.patient_control_number ?? ""),
    payerClaimNumber: row.payer_claim_number ? String(row.payer_claim_number) : null,
    claimStatus: String(row.claim_status ?? "submitted"),
    serviceDateFrom: row.service_date_from ? String(row.service_date_from) : null,
    totalChargeCents: Number(row.total_charge_cents ?? 0),
    paidAmountCents: row.paidAmountCents,
    openBalanceCents: row.openBalanceCents,
    submittedAt: row.submittedAt,
    clearinghouseStatus: row.clearinghouseStatus,
    clientName: row.clientName,
    payerName: row.payerName,
    renderingProviderName: row.providerName,
  };
}

export function ClaimsPage() {
  const [rows, setRows] = useState<ClaimsQueueRow[]>([]);
  const [payerId, setPayerId] = useState("");
  const [tab, setTab] = useState<ClaimsTab>("no_response");
  const [activeClaimId, setActiveClaimId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await getClaimsQueueData();
      setRows(data.filter((claim) =>
        getOperationalHome({
          claimStatus: claim.claim_status,
          latestResponseStatus: claim.clearinghouseStatus,
          hasActiveDenial: claim.hasActiveDenial,
          openBalanceCents: claim.openBalanceCents,
        }) === "claims",
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Claims.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const payerQueues = useMemo(() => {
    const values = new Map<string, { id: string; name: string; count: number }>();
    for (const claim of rows) {
      const id = String(claim.payer_id ?? "unassigned");
      const current = values.get(id);
      values.set(id, { id, name: claim.payerName || "Unassigned Payer", count: (current?.count ?? 0) + 1 });
    }
    return [...values.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  useEffect(() => {
    if (!payerQueues.length) {
      setPayerId("");
      return;
    }
    if (!payerQueues.some((payer) => payer.id === payerId)) setPayerId(payerQueues[0].id);
  }, [payerQueues, payerId]);

  const payerRows = useMemo(
    () => rows.filter((claim) => String(claim.payer_id ?? "unassigned") === payerId),
    [rows, payerId],
  );

  const rowsByTab = useMemo(() => {
    const map = new Map<ClaimsTab, ClaimsQueueRow[]>();
    for (const [key] of CLAIM_TABS) map.set(key, []);
    for (const claim of payerRows) {
      const key = getClaimsTab({
        deferred: claim.deferred,
        submittedAt: claim.submittedAt,
        serviceDate: claim.service_date_from ? String(claim.service_date_from) : null,
        hasPayerResponse: claim.hasPayerResponse,
      });
      map.get(key)?.push(claim);
    }
    return map;
  }, [payerRows]);

  const visible = rowsByTab.get(tab) ?? [];
  const activeIndex = visible.findIndex((claim) => claim.id === activeClaimId);
  const activeClaim = activeIndex >= 0 ? visible[activeIndex] : null;

  function openAt(index: number) {
    const claim = visible[index];
    if (claim) setActiveClaimId(claim.id);
  }

  async function runDefer(claim: ClaimsQueueRow) {
    const note = window.prompt("Why is this claim being deferred?")?.trim();
    if (!note) return;
    setSavingId(claim.id);
    setError(null);
    setMessage(null);
    try {
      await deferClaim(claim.id, note);
      setMessage("Claim moved to Deferred.");
      setActiveClaimId(null);
      setTab("deferred");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to defer claim.");
    } finally {
      setSavingId(null);
    }
  }

  async function runResume(claim: ClaimsQueueRow) {
    setSavingId(claim.id);
    setError(null);
    setMessage(null);
    try {
      await resumeClaim(claim.id);
      setMessage("Claim returned to active payer follow-up.");
      setActiveClaimId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to resume claim.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <>
      <div className="thera-page-header">
        <div>
          <div className="thera-eyebrow">REVENUE CYCLE</div>
          <h1>Claims</h1>
          <p>Outstanding payer claims organized into one workqueue per payer, then by response status and age.</p>
        </div>
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}
      {loading && <div className="thera-state">Loading Claims...</div>}

      {!loading && rows.length === 0 && <section className="thera-card"><div className="thera-empty">No outstanding payer claims.</div></section>}

      {!loading && rows.length > 0 && (
        <div className="thera-stack">
          <section className="thera-card">
            <div className="thera-card-header"><div><h2>Payer Workqueues</h2><p>Select a payer to work its outstanding claims.</p></div></div>
            <div className="thera-filter-row" style={{ flexWrap: "wrap" }}>
              {payerQueues.map((payer) => <button type="button" key={payer.id} className={payerId === payer.id ? "thera-action" : "thera-action secondary"} onClick={() => { setPayerId(payer.id); setActiveClaimId(null); }}>{payer.name} ({payer.count})</button>)}
            </div>
          </section>

          <div className="thera-tabs" role="tablist" aria-label="Claims aging">
            {CLAIM_TABS.map(([key, label]) => <button type="button" role="tab" aria-selected={tab === key} key={key} className={tab === key ? "thera-tab active" : "thera-tab"} onClick={() => { setTab(key); setActiveClaimId(null); }}>{label} ({rowsByTab.get(key)?.length ?? 0})</button>)}
          </div>

          <section className="thera-card">
            {visible.length === 0 ? <div className="thera-empty">No claims in this payer tab.</div> : <div className="thera-table-wrap">
              <table className="thera-table">
                <thead><tr><th>Claim</th><th>Patient</th><th>DOS</th><th>Provider</th><th>Submitted</th><th>Charge</th><th>Paid</th><th>Open</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>{visible.map((claim) => <tr key={claim.id}>
                  <td><button type="button" className="thera-table-link" onClick={() => setActiveClaimId(claim.id)}>{String(claim.patient_control_number ?? claim.id)}</button></td>
                  <td>{claim.clientName}</td>
                  <td>{shortDate(String(claim.service_date_from ?? ""))}</td>
                  <td>{claim.providerName}</td>
                  <td>{claim.submittedAt ? shortDate(claim.submittedAt) : "—"}</td>
                  <td>{money(Number(claim.total_charge_cents ?? 0))}</td>
                  <td>{money(claim.paidAmountCents)}</td>
                  <td>{money(claim.openBalanceCents)}</td>
                  <td><StatusBadge value={String(claim.claim_status ?? "submitted")} /></td>
                  <td><div className="thera-filter-row"><button type="button" className="thera-action" onClick={() => setActiveClaimId(claim.id)}>Work Claim</button>{claim.deferred ? <button type="button" className="thera-action secondary" disabled={savingId === claim.id} onClick={() => void runResume(claim)}>Resume</button> : <button type="button" className="thera-action secondary" disabled={savingId === claim.id} onClick={() => void runDefer(claim)}>Defer</button>}</div></td>
                </tr>)}</tbody>
              </table>
            </div>}
          </section>
        </div>
      )}

      <ClaimWorkDrawer
        claim={activeClaim ? asDrawerClaim(activeClaim) : null}
        open={Boolean(activeClaim)}
        mode="follow_up"
        onOpenChange={(open) => {
          if (!open) {
            setActiveClaimId(null);
            void load();
          }
        }}
        queuePosition={activeClaim ? `${activeIndex + 1} of ${visible.length}` : undefined}
        onPrevious={() => openAt(activeIndex - 1)}
        onNext={() => openAt(activeIndex + 1)}
        previousDisabled={activeIndex <= 0}
        nextDisabled={activeIndex < 0 || activeIndex >= visible.length - 1}
      />
    </>
  );
}
