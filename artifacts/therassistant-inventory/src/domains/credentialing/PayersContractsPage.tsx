import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { StatusBadge } from "../../components/status-badge";
import { tenantSelect, referenceSelect } from "../../lib/tenant-data-client";
import { shortDate } from "../../lib/format";

type Row = Record<string, any>;

async function apiJson(path: string, init: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

export function PayersContractsPage() {
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payers, setPayers] = useState<Row[]>([]);
  const [contracts, setContracts] = useState<Row[]>([]);
  const [plans, setPlans] = useState<Row[]>([]);
  const [enrollments, setEnrollments] = useState<Row[]>([]);
  const [newContractPayer, setNewContractPayer] = useState<Row | null>(null);
  const [contractName, setContractName] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      referenceSelect("payers"),
      tenantSelect("payer_contracts"),
      referenceSelect("payer_plans"),
      tenantSelect("provider_payer_enrollments"),
    ])
      .then(([payerRows, contractRows, planRows, enrollmentRows]) => {
        if (!active) return;
        setPayers(payerRows);
        setContracts(contractRows);
        setPlans(planRows);
        setEnrollments(enrollmentRows);
      })
      .catch((err: unknown) => active && setError(err instanceof Error ? err.message : "Unable to load payers"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [version]);

  const rows = useMemo(() => payers.map((payer) => ({
    payer,
    contracts: contracts.filter((row) => row.payer_id === payer.id),
    planCount: plans.filter((row) => row.payer_id === payer.id).length,
    enrollmentCount: enrollments.filter((row) => row.payer_id === payer.id).length,
  })), [payers, contracts, plans, enrollments]);

  async function saveContract() {
    if (!newContractPayer || !contractName.trim()) return;
    setError(null);
    try {
      await apiJson(`/api/payers/${newContractPayer.id}/contracts`, {
        method: "POST",
        body: JSON.stringify({ contract_name: contractName.trim(), status: "draft", effective_date: effectiveDate || null }),
      });
      setNewContractPayer(null);
      setContractName("");
      setEffectiveDate("");
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save contract");
    }
  }

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">CONTRACT INTELLIGENCE</div>
          <h1>Payers & Contracts</h1>
          <p>Payer plans, provider participation, contracts and fee schedules in one workspace.</p>
        </div>
        <Link href="/credentialing" className="thera-action secondary">Credentialing</Link>
      </div>

      {error && <div className="thera-state error">{error}</div>}
      <section className="thera-card">
        {loading && <div className="thera-state">Loading payers...</div>}
        {!loading && <div className="thera-table-wrap">
          <table className="thera-table">
            <thead><tr><th>Payer</th><th>Type</th><th>Clearinghouse ID</th><th>Plans</th><th>Providers</th><th>Contracts</th><th>Contract Status</th><th>Actions</th></tr></thead>
            <tbody>{rows.map(({ payer, contracts: payerContracts, planCount, enrollmentCount }) => {
              const active = payerContracts.find((contract) => contract.status === "active") ?? payerContracts[0];
              return <tr key={payer.id}>
                <td><Link className="thera-table-link" href={`/payers/${payer.id}`}>{payer.name}</Link></td>
                <td>{payer.payer_type || "—"}</td>
                <td>{payer.clearinghouse_payer_id || "—"}</td>
                <td>{planCount}</td>
                <td>{enrollmentCount}</td>
                <td>{payerContracts.length}</td>
                <td>{active ? <><StatusBadge value={active.status} /><div className="thera-table-subtext">{active.contract_name} · {shortDate(active.effective_date)}</div></> : "No contract"}</td>
                <td><div className="thera-filter-row"><Link className="thera-action secondary" href={`/payers/${payer.id}`}>Open Payer</Link><button type="button" className="thera-action secondary" onClick={() => setNewContractPayer(payer)}>+ Contract</button></div></td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
      </section>

      {newContractPayer && <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 1000, padding: 20 }}>
        <section className="thera-card" style={{ width: "min(620px,100%)" }}>
          <div className="thera-card-header"><div><h2>Add Contract</h2><p>{newContractPayer.name}</p></div><button type="button" className="thera-action secondary" onClick={() => setNewContractPayer(null)}>Close</button></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12 }}>
            <label><div className="thera-field-label">Contract Name</div><input className="thera-input" value={contractName} onChange={(event) => setContractName(event.target.value)} /></label>
            <label><div className="thera-field-label">Effective Date</div><input className="thera-input" type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} /></label>
          </div>
          <div style={{ marginTop: 16 }}><button type="button" className="thera-action" onClick={() => void saveContract()}>Save Contract</button></div>
        </section>
      </div>}
    </>
  );
}
