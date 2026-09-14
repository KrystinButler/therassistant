import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { StatusBadge } from "../../components/status-badge";
import { demoRows, referenceRows } from "../../lib/demo-data";
import { shortDate } from "../../lib/format";
import {
  availableEnrollmentActions,
  revalidationState,
  type EnrollmentStatus,
} from "./workflow";

type Row = Record<string, any>;

type EditForm = {
  id: string;
  effective_date: string;
  revalidation_due_date: string;
  termination_date: string;
  payer_provider_id: string;
  notes: string;
};

function fullName(row?: Row | null) {
  return row ? [row.first_name, row.last_name].filter(Boolean).join(" ") : "—";
}

function byId(rows: Row[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

async function apiJson(path: string, init: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

export function CredentialingPage() {
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enrollments, setEnrollments] = useState<Row[]>([]);
  const [providers, setProviders] = useState<Row[]>([]);
  const [payers, setPayers] = useState<Row[]>([]);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    apiJson("/api/credentialing/sync-revalidation", { method: "POST" }).catch(() => null);

    Promise.all([
      demoRows("provider_payer_enrollments"),
      demoRows("providers"),
      referenceRows("payers"),
    ])
      .then(([enrollmentRows, providerRows, payerRows]) => {
        if (!active) return;
        setEnrollments(enrollmentRows);
        setProviders(providerRows);
        setPayers(payerRows);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : "Unable to load credentialing data");
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [version]);

  const providerMap = useMemo(() => byId(providers), [providers]);
  const payerMap = useMemo(() => byId(payers), [payers]);

  async function transition(enrollment: Row, nextStatus: EnrollmentStatus, label: string) {
    setError(null);
    try {
      await apiJson(`/api/credentialing/enrollments/${enrollment.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          enrollment_status: nextStatus,
          reason: label,
        }),
      });
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update enrollment");
    }
  }

  async function saveEdit() {
    if (!editForm) return;
    setSaving(true);
    setError(null);
    try {
      await apiJson(`/api/credentialing/enrollments/${editForm.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          effective_date: editForm.effective_date || null,
          revalidation_due_date: editForm.revalidation_due_date || null,
          termination_date: editForm.termination_date || null,
          payer_provider_id: editForm.payer_provider_id || null,
          notes: editForm.notes || null,
          reason: "Credentialing record details updated",
        }),
      });
      setEditForm(null);
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save enrollment");
    } finally {
      setSaving(false);
    }
  }

  const actionRequired = enrollments.filter((enrollment) => {
    const state = revalidationState({
      enrollment_status: enrollment.enrollment_status,
      revalidation_due_date: enrollment.revalidation_due_date,
    });
    return state === "due_soon" || state === "overdue" || enrollment.enrollment_status === "needs_revalidation";
  }).length;

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">PAYER OPERATIONS</div>
          <h1>Credentialing</h1>
          <p>Provider-payer enrollment, participation, identifiers and revalidation work.</p>
        </div>
        <div className="thera-filter-row">
          <Link className="thera-action secondary" href="/providers">Providers</Link>
          <Link className="thera-action" href="/payers-contracts">Payers & Contracts</Link>
        </div>
      </div>

      <div className="thera-metric-grid">
        <div className="thera-metric-card"><div className="thera-metric-label">Enrollments</div><div className="thera-metric-value">{enrollments.length}</div></div>
        <div className="thera-metric-card"><div className="thera-metric-label">Approved</div><div className="thera-metric-value">{enrollments.filter((row) => row.enrollment_status === "approved").length}</div></div>
        <div className="thera-metric-card"><div className="thera-metric-label">Submitted</div><div className="thera-metric-value">{enrollments.filter((row) => row.enrollment_status === "submitted").length}</div></div>
        <div className="thera-metric-card"><div className="thera-metric-label">Revalidation Action</div><div className="thera-metric-value">{actionRequired}</div></div>
      </div>

      {error && <div className="thera-state error">{error}</div>}

      <section className="thera-card">
        {loading && <div className="thera-state">Loading credentialing...</div>}
        {!loading && (
          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Payer</th>
                  <th>Status</th>
                  <th>Effective</th>
                  <th>Revalidation</th>
                  <th>Due State</th>
                  <th>Payer Provider ID</th>
                  <th>Notes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map((enrollment) => {
                  const dueState = revalidationState({
                    enrollment_status: enrollment.enrollment_status,
                    revalidation_due_date: enrollment.revalidation_due_date,
                  });
                  const actions = availableEnrollmentActions(enrollment.enrollment_status as EnrollmentStatus);
                  return (
                    <tr key={enrollment.id}>
                      <td><Link className="thera-table-link" href={`/providers/${enrollment.provider_id}`}>{fullName(providerMap.get(enrollment.provider_id))}</Link></td>
                      <td><Link className="thera-table-link" href={`/payers/${enrollment.payer_id}`}>{payerMap.get(enrollment.payer_id)?.name || "—"}</Link></td>
                      <td><StatusBadge value={enrollment.enrollment_status} /></td>
                      <td>{shortDate(enrollment.effective_date)}</td>
                      <td>{shortDate(enrollment.revalidation_due_date)}</td>
                      <td><StatusBadge value={dueState} /></td>
                      <td>{enrollment.payer_provider_id || "—"}</td>
                      <td>{enrollment.notes || "—"}</td>
                      <td>
                        <div className="thera-filter-row">
                          {actions.map((action) => (
                            <button
                              type="button"
                              className="thera-action secondary"
                              key={action.nextStatus}
                              onClick={() => void transition(enrollment, action.nextStatus, action.label)}
                            >
                              {action.label}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="thera-action secondary"
                            onClick={() => setEditForm({
                              id: enrollment.id,
                              effective_date: enrollment.effective_date || "",
                              revalidation_due_date: enrollment.revalidation_due_date || "",
                              termination_date: enrollment.termination_date || "",
                              payer_provider_id: enrollment.payer_provider_id || "",
                              notes: enrollment.notes || "",
                            })}
                          >
                            Edit Details
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 1000, padding: 20 }}>
          <section className="thera-card" style={{ width: "min(760px,100%)" }}>
            <div className="thera-card-header">
              <div><h2>Edit Enrollment</h2><p>Maintain payer IDs, participation dates and revalidation deadlines.</p></div>
              <button type="button" className="thera-action secondary" onClick={() => setEditForm(null)}>Close</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12 }}>
              <label><div className="thera-field-label">Effective Date</div><input className="thera-input" type="date" value={editForm.effective_date} onChange={(event) => setEditForm({ ...editForm, effective_date: event.target.value })} /></label>
              <label><div className="thera-field-label">Revalidation Due</div><input className="thera-input" type="date" value={editForm.revalidation_due_date} onChange={(event) => setEditForm({ ...editForm, revalidation_due_date: event.target.value })} /></label>
              <label><div className="thera-field-label">Termination Date</div><input className="thera-input" type="date" value={editForm.termination_date} onChange={(event) => setEditForm({ ...editForm, termination_date: event.target.value })} /></label>
              <label><div className="thera-field-label">Payer Provider ID</div><input className="thera-input" value={editForm.payer_provider_id} onChange={(event) => setEditForm({ ...editForm, payer_provider_id: event.target.value })} /></label>
              <label style={{ gridColumn: "1 / -1" }}><div className="thera-field-label">Notes</div><textarea className="thera-input" rows={4} value={editForm.notes} onChange={(event) => setEditForm({ ...editForm, notes: event.target.value })} /></label>
            </div>
            <div style={{ marginTop: 16 }}><button type="button" className="thera-action" disabled={saving} onClick={() => void saveEdit()}>{saving ? "Saving..." : "Save Enrollment"}</button></div>
          </section>
        </div>
      )}
    </>
  );
}
