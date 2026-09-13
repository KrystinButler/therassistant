import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { shortDate } from "../../lib/format";
import { getAuthorizationQueueData } from "./repository";

type AuthorizationRow = Awaited<ReturnType<typeof getAuthorizationQueueData>>[number];

export function AuthorizationsPage() {
  const [rows, setRows] = useState<AuthorizationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attentionOnly, setAttentionOnly] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getAuthorizationQueueData()
      .then((result) => {
        if (active) setRows(result);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Unable to load authorization queue.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const visible = useMemo(
    () => (attentionOnly ? rows.filter((row) => row.needsAttention) : rows),
    [rows, attentionOnly],
  );
  const attentionCount = rows.filter((row) => row.needsAttention).length;

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">UTILIZATION MANAGEMENT</div>
          <h1>Authorizations</h1>
          <p>Current authorization readiness by patient, including missing approvals, expiration, and unit utilization.</p>
        </div>
        <button
          type="button"
          className={attentionOnly ? "thera-action" : "thera-action secondary"}
          onClick={() => setAttentionOnly((value) => !value)}
        >
          {attentionOnly ? "Show All" : `Needs Attention (${attentionCount})`}
        </button>
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {loading ? <div className="thera-state">Loading authorization queue...</div> : (
        <section className="thera-card">
          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead>
                <tr><th>Patient</th><th>Payer</th><th>Authorization</th><th>Status</th><th>End Date</th><th>Units Left</th><th>Alert</th><th>Action</th></tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id}>
                    <td><Link className="thera-table-link" href={`/clients/${row.patientId}`}>{row.patientName}</Link></td>
                    <td>{row.payerName}</td>
                    <td>{row.authorizationNumber || "—"}</td>
                    <td><StatusBadge value={row.status} /></td>
                    <td>{row.endDate ? shortDate(row.endDate) : "—"}</td>
                    <td>{row.remainingUnits ?? "—"}</td>
                    <td><StatusBadge value={row.alert} /></td>
                    <td><Link className="thera-link" href={`/clients/${row.patientId}`}>Open Patient Chart</Link></td>
                  </tr>
                ))}
                {visible.length === 0 && <tr><td colSpan={8}><div className="thera-empty">No authorization records match this view.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
