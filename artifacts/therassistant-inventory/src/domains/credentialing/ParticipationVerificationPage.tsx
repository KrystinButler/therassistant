import { useEffect, useMemo, useState } from "react";

import { StatusBadge } from "../../components/status-badge";
import { shortDate } from "../../lib/format";
import { tenantSelect } from "../../lib/tenant-data-client";
import {
  createParticipationVerification,
  loadNetworks,
  loadPayers,
  loadPlans,
  loadVerificationHistory,
  pollParticipationVerification,
  type CatalogNetwork,
  type CatalogPayer,
  type CatalogPlan,
  type VerificationResult,
} from "./participation-api";

type Row = Record<string, any>;

function labelProvider(row: Row) {
  return [row.first_name, row.last_name, row.credentials].filter(Boolean).join(" ");
}

function resultTitle(status: VerificationResult["status"]) {
  if (status === "PARTICIPATING") return "Participating";
  if (status === "NOT_FOUND") return "Not Found";
  if (status === "UNABLE_TO_VERIFY") return "Unable to Verify";
  return "Verification in progress...";
}

function MatchList({ result }: { result: VerificationResult }) {
  const matches = result.matches ?? [];
  if (!matches.length) return null;
  return (
    <div className="thera-table-wrap" style={{ marginTop: 12 }}>
      <table className="thera-table">
        <thead><tr><th>Evidence</th><th>Expected</th><th>Observed</th><th>Match</th></tr></thead>
        <tbody>
          {matches.map((row, index) => (
            <tr key={`${row.match_type}-${index}`}>
              <td>{String(row.match_type ?? "Evidence").replaceAll("_", " ")}</td>
              <td>{row.expected_value || "—"}</td>
              <td>{row.observed_value || "—"}</td>
              <td><StatusBadge value={row.matched ? "confirmed" : "review"} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ParticipationVerificationPage() {
  const [providers, setProviders] = useState<Row[]>([]);
  const [organizations, setOrganizations] = useState<Row[]>([]);
  const [locations, setLocations] = useState<Row[]>([]);
  const [payers, setPayers] = useState<CatalogPayer[]>([]);
  const [plans, setPlans] = useState<CatalogPlan[]>([]);
  const [networks, setNetworks] = useState<CatalogNetwork[]>([]);
  const [history, setHistory] = useState<VerificationResult[]>([]);

  const [providerId, setProviderId] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [payerId, setPayerId] = useState("");
  const [planId, setPlanId] = useState("");
  const [networkId, setNetworkId] = useState("");
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      tenantSelect<Row>("providers", { order: "last_name.asc,first_name.asc" }),
      tenantSelect<Row>("practice_entities", { order: "legal_name.asc" }),
      tenantSelect<Row>("practice_locations", { order: "name.asc" }),
      loadPayers(),
    ]).then(([providerRows, organizationRows, locationRows, payerRows]) => {
      if (!active) return;
      setProviders(providerRows.filter((row) => row.provider_status !== "inactive"));
      setOrganizations(organizationRows.filter((row) => row.status !== "inactive"));
      setLocations(locationRows.filter((row) => row.status !== "inactive"));
      setPayers(payerRows);
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : "Unable to load participation workspace.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setPlanId("");
    setNetworkId("");
    setNetworks([]);
    setPlans([]);
    if (!payerId) return;
    void loadPlans(payerId)
      .then(setPlans)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Unable to load plans."));
  }, [payerId]);

  useEffect(() => {
    setNetworkId("");
    setNetworks([]);
    if (!planId) return;
    void loadNetworks(planId)
      .then(setNetworks)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Unable to load networks."));
  }, [planId]);

  useEffect(() => {
    setHistory([]);
    if (!providerId) return;
    void loadVerificationHistory(providerId)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [providerId]);

  const filteredLocations = useMemo(
    () => organizationId
      ? locations.filter((row) => row.practice_entity_id === organizationId)
      : locations,
    [locations, organizationId],
  );

  const selectedPayer = payers.find((row) => row.id === payerId) ?? null;
  const selectedPlan = plans.find((row) => row.id === planId) ?? null;
  const selectedNetwork = networks.find((row) => row.id === networkId) ?? null;
  const canVerify = Boolean(providerId && payerId && planId && networkId && !verifying);

  async function verify() {
    if (!canVerify) return;
    setError(null);
    setResult(null);
    setShowEvidence(false);
    setVerifying(true);
    try {
      const created = await createParticipationVerification({
        provider_id: providerId,
        organization_id: organizationId || null,
        practice_location_id: locationId || null,
        payer_id: payerId,
        plan_id: planId,
        network_id: networkId,
      });
      setResult({ status: "IN_PROGRESS", verificationId: created.verificationId });
      const completed = await pollParticipationVerification(created.verificationId);
      setResult(completed);
      const refreshed = await loadVerificationHistory(providerId);
      setHistory(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to verify participation.");
    } finally {
      setVerifying(false);
    }
  }

  if (loading) return <div className="thera-state">Loading participation verification...</div>;

  return <>
    <div className="thera-page-header split">
      <div>
        <div className="thera-eyebrow">COLORADO · PROVIDER DIRECTORY VERIFICATION</div>
        <h1>Verify Participation</h1>
        <p>Check whether the selected provider and practice appear in the selected payer plan and network using evidence from supported official sources.</p>
      </div>
    </div>

    {error && <div className="thera-state error" style={{ marginBottom: 14 }}>{error}</div>}

    <section className="thera-card" style={{ marginBottom: 14 }}>
      <div className="thera-card-header"><h2>Verification Request</h2><p>Provider-directory verification is separate from formal credentialing, contracting, eligibility and reimbursement.</p></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
        <label className="thera-field"><span className="thera-field-label">Provider</span><select className="thera-input" value={providerId} onChange={(e) => setProviderId(e.target.value)}><option value="">Select provider</option>{providers.map((row) => <option key={row.id} value={row.id}>{labelProvider(row)} · NPI {row.individual_npi || "missing"}</option>)}</select></label>
        <label className="thera-field"><span className="thera-field-label">Practice</span><select className="thera-input" value={organizationId} onChange={(e) => { setOrganizationId(e.target.value); setLocationId(""); }}><option value="">No group selected</option>{organizations.map((row) => <option key={row.id} value={row.id}>{row.dba_name || row.legal_name} · NPI {row.group_npi || "missing"}</option>)}</select></label>
        <label className="thera-field"><span className="thera-field-label">Location</span><select className="thera-input" value={locationId} onChange={(e) => setLocationId(e.target.value)}><option value="">Select location</option>{filteredLocations.map((row) => <option key={row.id} value={row.id}>{row.name} · {[row.city, row.state, row.postal_code].filter(Boolean).join(" ")}</option>)}</select></label>
        <label className="thera-field"><span className="thera-field-label">Payer</span><select className="thera-input" value={payerId} onChange={(e) => setPayerId(e.target.value)}><option value="">Select payer</option>{payers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label className="thera-field"><span className="thera-field-label">Plan</span><select className="thera-input" value={planId} disabled={!payerId} onChange={(e) => setPlanId(e.target.value)}><option value="">{payerId && !plans.length ? "No synchronized plans available" : "Select plan"}</option>{plans.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label className="thera-field"><span className="thera-field-label">Network</span><select className="thera-input" value={networkId} disabled={!planId} onChange={(e) => setNetworkId(e.target.value)}><option value="">{planId && !networks.length ? "No synchronized networks available" : "Select network"}</option>{networks.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      </div>
      {selectedPayer && !plans.length && <div className="thera-state" style={{ marginTop: 12 }}>The {selectedPayer.name} plan/network catalog has not been synchronized yet. No network conclusion will be guessed.</div>}
      <div style={{ marginTop: 14 }}><button className="thera-action" type="button" disabled={!canVerify} onClick={() => void verify()}>{verifying ? "Verification in progress..." : "Verify Participation"}</button></div>
    </section>

    {result && <section className="thera-card" style={{ marginBottom: 14 }}>
      <div className="thera-card-header split">
        <div>
          <div className="thera-eyebrow">RESULT</div>
          <h2>{resultTitle(result.status)}</h2>
          <p>{selectedPayer?.name}{selectedPlan ? ` · ${selectedPlan.name}` : ""}{selectedNetwork ? ` · ${selectedNetwork.name}` : ""}</p>
        </div>
        <div style={{ textAlign: "right" }}>{result.confidence && <><div className="thera-eyebrow">CONFIDENCE</div><strong>{result.confidence}</strong></>}</div>
      </div>
      {result.status === "NOT_FOUND" && <div className="thera-state">The selected payer directory was successfully searched, but sufficient evidence of participation with this plan/network was not found. <strong>This does not establish that the provider is out-of-network.</strong></div>}
      {result.status === "UNABLE_TO_VERIFY" && <div className="thera-state">We could not establish participation using the available payer information.{result.failure_detail ? ` ${result.failure_detail}` : ""}</div>}
      {result.status === "PARTICIPATING" && <div className="thera-state">Official directory evidence supports participation with the selected plan/network. This is not a guarantee of reimbursement, eligibility, benefits, or coverage.</div>}
      <div className="thera-filter-row" style={{ marginTop: 12, flexWrap: "wrap" }}>
        {result.source_updated_at && <span className="thera-table-subtext">Directory updated: {shortDate(result.source_updated_at)}</span>}
        {result.verified_at && <span className="thera-table-subtext">Verified: {shortDate(result.verified_at)}</span>}
      </div>
      <div className="thera-filter-row" style={{ marginTop: 12, flexWrap: "wrap" }}>
        <button className="thera-action secondary" type="button" onClick={() => setShowEvidence((value) => !value)}>{showEvidence ? "Hide Evidence" : "View Evidence"}</button>
        {result.source_reference && /^https:\/\//i.test(result.source_reference) && <a className="thera-action secondary" href={result.source_reference} target="_blank" rel="noreferrer">Open Official Payer Directory ↗</a>}
      </div>
      {showEvidence && <><MatchList result={result} /><pre style={{ whiteSpace: "pre-wrap", fontSize: ".72rem", marginTop: 12, maxHeight: 320, overflow: "auto" }}>{JSON.stringify(result.evidence ?? [], null, 2)}</pre></>}
    </section>}

    <section className="thera-card">
      <div className="thera-card-header"><h2>Verification History</h2><p>Historical results are retained as evidence and are not silently rewritten by later directory changes.</p></div>
      {!providerId && <div className="thera-empty">Select a provider to view verification history.</div>}
      {providerId && !history.length && <div className="thera-empty">No automated participation verifications recorded yet.</div>}
      {history.length > 0 && <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Requested</th><th>Status</th><th>Confidence</th><th>Source</th><th>Verified</th></tr></thead><tbody>{history.map((row) => <tr key={row.id || row.verificationId}><td>{shortDate(row.requested_at)}</td><td><StatusBadge value={String(row.status)} /></td><td>{row.confidence || "—"}</td><td>{row.source_type || "—"}</td><td>{shortDate(row.verified_at)}</td></tr>)}</tbody></table></div>}
    </section>
  </>;
}
