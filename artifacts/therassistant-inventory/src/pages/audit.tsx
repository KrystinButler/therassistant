import { useEffect, useMemo, useState } from "react";

import { dateTime } from "../lib/format";
import { tenantSelect, type Row } from "../lib/tenant-data-client";

type DocumentHistoryRow = Row & {
  id: string;
  document_id?: string | null;
  event_type?: string | null;
  snapshot?: Row | null;
  actor_id?: string | null;
  created_at?: string | null;
};

type AuditRow = Row & {
  id: string;
  actor_id?: string | null;
  action?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  old_values?: Row | null;
  new_values?: Row | null;
  metadata?: Row | null;
  created_at?: string | null;
};

function pretty(value: unknown) {
  if (!value || (typeof value === "object" && Object.keys(value as object).length === 0)) return "—";
  return JSON.stringify(value, null, 2);
}

export function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [documentHistory, setDocumentHistory] = useState<DocumentHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [targetType, setTargetType] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      tenantSelect<AuditRow>("audit_logs", { order: "created_at.desc" }),
      tenantSelect<DocumentHistoryRow>("document_history", { order: "created_at.desc" }),
    ])
      .then(([result, documentRows]) => {
        if (active) {
          setRows(result);
          setDocumentHistory(documentRows);
        }
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : "Unable to load audit history.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const actions = useMemo(
    () => [...new Set(rows.map((row) => String(row.action ?? "")).filter(Boolean))].sort(),
    [rows],
  );
  const targetTypes = useMemo(
    () => [...new Set(rows.map((row) => String(row.target_type ?? "")).filter(Boolean))].sort(),
    [rows],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (action && String(row.action ?? "") !== action) return false;
      if (targetType && String(row.target_type ?? "") !== targetType) return false;
      if (!needle) return true;
      return [
        row.action,
        row.target_type,
        row.target_id,
        row.actor_id,
        JSON.stringify(row.metadata ?? {}),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, search, action, targetType]);

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">OPERATE · AUDIT HISTORY</div>
          <h1>Audit & PHI Activity</h1>
          <p>
            Tenant activity history across clinical, financial, credentialing, payer, document,
            and administrative records.
          </p>
        </div>
        <div className="thera-metric-card" style={{ minWidth: 150 }}>
          <div className="thera-metric-label">Events</div>
          <div className="thera-metric-value">{visible.length}</div>
        </div>
      </div>

      <section className="thera-card" style={{ marginBottom: 16 }}>
        <div className="thera-filter-row" style={{ flexWrap: "wrap" }}>
          <input
            className="thera-input"
            style={{ minWidth: 260, flex: "1 1 260px" }}
            value={search}
            placeholder="Search action, record, actor, or metadata"
            onChange={(event) => setSearch(event.target.value)}
          />
          <select className="thera-input" value={action} onChange={(event) => setAction(event.target.value)}>
            <option value="">All actions</option>
            {actions.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
          </select>
          <select className="thera-input" value={targetType} onChange={(event) => setTargetType(event.target.value)}>
            <option value="">All record types</option>
            {targetTypes.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
          </select>
        </div>
      </section>

      {loading && <div className="thera-state">Loading audit history...</div>}
      {error && <div className="thera-state error">{error}</div>}

      {!loading && !error && (
        <>
        <section className="thera-card">
          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Record Type</th>
                  <th>Record</th>
                  <th>Actor</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id}>
                    <td>{row.created_at ? dateTime(String(row.created_at)) : "—"}</td>
                    <td>{String(row.action ?? "—").replaceAll("_", " ")}</td>
                    <td>{String(row.target_type ?? "—").replaceAll("_", " ")}</td>
                    <td className="thera-table-subtext">{row.target_id ? String(row.target_id) : "—"}</td>
                    <td className="thera-table-subtext">{row.actor_id ? String(row.actor_id) : "System"}</td>
                    <td>
                      <details>
                        <summary className="thera-link" style={{ cursor: "pointer" }}>View</summary>
                        <div className="thera-stack" style={{ marginTop: 10, minWidth: 320 }}>
                          <div>
                            <div className="thera-field-label">Previous</div>
                            <pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{pretty(row.old_values)}</pre>
                          </div>
                          <div>
                            <div className="thera-field-label">New</div>
                            <pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{pretty(row.new_values)}</pre>
                          </div>
                          <div>
                            <div className="thera-field-label">Metadata</div>
                            <pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{pretty(row.metadata)}</pre>
                          </div>
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr><td colSpan={6}><div className="thera-empty">No audit events match this view.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="thera-card" style={{ marginTop: 16 }}>
          <div className="thera-card-header">
            <div>
              <h2>Document History</h2>
              <p>Append-only snapshots preserve document creation, edits, status changes, archive, and void events.</p>
            </div>
          </div>
          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead><tr><th>When</th><th>Event</th><th>Document</th><th>Actor</th><th>Snapshot</th></tr></thead>
              <tbody>
                {documentHistory.map((row) => (
                  <tr key={row.id}>
                    <td>{row.created_at ? dateTime(String(row.created_at)) : "—"}</td>
                    <td>{String(row.event_type ?? "—").replaceAll("_", " ")}</td>
                    <td className="thera-table-subtext">{String(row.document_id ?? "—")}</td>
                    <td className="thera-table-subtext">{String(row.actor_id ?? "System")}</td>
                    <td>
                      <details>
                        <summary className="thera-link" style={{ cursor: "pointer" }}>View snapshot</summary>
                        <pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{pretty(row.snapshot)}</pre>
                      </details>
                    </td>
                  </tr>
                ))}
                {documentHistory.length === 0 && <tr><td colSpan={5}><div className="thera-empty">No document history yet.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </section>
        </>
      )}
    </>
  );
}
