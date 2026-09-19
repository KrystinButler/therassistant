import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { WorkDrawer } from "../../components/work-drawer";
import { shortDate } from "../../lib/format";
import { tenantSelect, type Row } from "../../lib/tenant-data-client";
import {
  createAuthorization,
  updateAuthorization,
} from "../authorizations/repository";
import type { AuthorizationDraft } from "../authorizations/workflow";
import { getAuthorizationQueueData } from "./repository";

type AuthorizationRow = Awaited<ReturnType<typeof getAuthorizationQueueData>>[number];
type DataRow = Row & { id: string };

type AuthorizationForm = AuthorizationDraft & {
  authorizationId: string | null;
  patientId: string;
};

const statusOptions: AuthorizationDraft["status"][] = [
  "pending",
  "approved",
  "denied",
  "not_required",
  "expired",
  "exhausted",
  "cancelled",
  "unknown",
];

function blankForm(row: AuthorizationRow): AuthorizationForm {
  return {
    authorizationId: row.authorizationId,
    patientId: row.patientId,
    payerId: row.payerId ?? "",
    authorizationNumber: row.authorizationNumber ?? "",
    status: row.authorizationId
      ? (row.status as AuthorizationDraft["status"])
      : "pending",
    startDate: "",
    endDate: row.endDate ?? "",
    notes: "",
  };
}

export function AuthorizationsPage() {
  const [, navigate] = useLocation();
  const [rows, setRows] = useState<AuthorizationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [activeRow, setActiveRow] = useState<AuthorizationRow | null>(null);
  const [form, setForm] = useState<AuthorizationForm | null>(null);
  const [baseline, setBaseline] = useState<AuthorizationForm | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await getAuthorizationQueueData());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load authorization queue.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const visible = useMemo(
    () => (attentionOnly ? rows.filter((row) => row.needsAttention) : rows),
    [rows, attentionOnly],
  );
  const attentionCount = rows.filter((row) => row.needsAttention).length;
  const activeIndex = activeRow ? visible.findIndex((row) => row.id === activeRow.id) : -1;
  const dirty = Boolean(form && baseline && JSON.stringify(form) !== JSON.stringify(baseline));

  async function openRow(row: AuthorizationRow) {
    setActiveRow(row);
    setMessage(null);
    setError(null);
    setDrawerLoading(true);

    try {
      let next = blankForm(row);
      if (row.authorizationId) {
        const detail = (
          await tenantSelect<DataRow>("authorizations", {
            id: `eq.${row.authorizationId}`,
            limit: "1",
          })
        )[0];

        if (detail) {
          next = {
            authorizationId: detail.id,
            patientId: row.patientId,
            payerId: String(detail.payer_id ?? row.payerId ?? ""),
            authorizationNumber: String(detail.authorization_number ?? ""),
            status: String(detail.status ?? "pending") as AuthorizationDraft["status"],
            startDate: String(detail.start_date ?? ""),
            endDate: String(detail.end_date ?? ""),
            notes: String(detail.notes ?? ""),
          };
        }
      }
      setForm(next);
      setBaseline({ ...next });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load authorization.");
    } finally {
      setDrawerLoading(false);
    }
  }

  function closeDrawer() {
    setActiveRow(null);
    setForm(null);
    setBaseline(null);
  }

  function openAt(index: number) {
    const row = visible[index];
    if (row) void openRow(row);
  }

  async function saveAuthorization() {
    if (!activeRow || !form) return;

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const draft: AuthorizationDraft = {
        payerId: form.payerId,
        authorizationNumber: form.authorizationNumber,
        status: form.status,
        startDate: form.startDate,
        endDate: form.endDate,
        notes: form.notes,
      };

      if (form.authorizationId) {
        await updateAuthorization(form.authorizationId, draft);
        setMessage("Authorization updated.");
      } else {
        await createAuthorization(form.patientId, draft);
        setMessage("Authorization created.");
      }

      closeDrawer();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save authorization.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">UTILIZATION MANAGEMENT</div>
          <h1>Authorizations</h1>
          <p>Create and update payer authorizations, monitor expiration and units, and route detailed unit work through Patient 360.</p>
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
      {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}

      {loading ? (
        <div className="thera-state">Loading authorization queue...</div>
      ) : (
        <section className="thera-card">
          <div className="thera-table-wrap">
            <table className="thera-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Payer</th>
                  <th>Authorization</th>
                  <th>Status</th>
                  <th>End Date</th>
                  <th>Units Left</th>
                  <th>Alert</th>
                  <th>Action</th>
                </tr>
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
                    <td>
                      <button type="button" className="thera-action" onClick={() => void openRow(row)}>
                        {row.authorizationId ? "Work Authorization" : "Create Authorization"}
                      </button>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr><td colSpan={8}><div className="thera-empty">No authorization records match this view.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeRow && form && (
        <WorkDrawer
          open={Boolean(activeRow)}
          onOpenChange={(open) => { if (!open) closeDrawer(); }}
          dirty={dirty}
          title={form.authorizationId ? "Authorization Work" : "Create Authorization"}
          subtitle={`${activeRow.patientName} · ${activeRow.payerName}`}
          badges={<><StatusBadge value={form.status} /><StatusBadge value={activeRow.alert} /></>}
          queuePosition={activeIndex >= 0 ? `${activeIndex + 1} of ${visible.length}` : undefined}
          onPrevious={() => openAt(activeIndex - 1)}
          onNext={() => openAt(activeIndex + 1)}
          previousDisabled={activeIndex <= 0}
          nextDisabled={activeIndex < 0 || activeIndex >= visible.length - 1}
          openFullRecord={() => navigate(`/clients/${activeRow.patientId}`)}
          openFullRecordLabel="Open Patient 360"
          footer={
            <div className="thera-filter-row" style={{ justifyContent: "space-between", width: "100%" }}>
              <button type="button" className="thera-action secondary" onClick={closeDrawer}>Cancel</button>
              <button type="button" className="thera-action" disabled={saving || drawerLoading || !form.payerId} onClick={() => void saveAuthorization()}>
                {saving ? "Saving..." : form.authorizationId ? "Save Authorization" : "Create Authorization"}
              </button>
            </div>
          }
        >
          {drawerLoading ? (
            <div className="thera-state">Loading authorization...</div>
          ) : (
            <div className="thera-stack">
              <section className="thera-card">
                <div className="thera-card-header"><div><h2>Authorization Details</h2><p>These values feed scheduling and billing readiness.</p></div></div>
                <div className="thera-form-grid">
                  <Field label="Patient" value={activeRow.patientName} />
                  <Field label="Payer" value={activeRow.payerName} />
                  <label className="thera-field">
                    <span className="thera-field-label">Authorization Number</span>
                    <input className="thera-input" value={form.authorizationNumber ?? ""} onChange={(e) => setForm({ ...form, authorizationNumber: e.target.value })} />
                  </label>
                  <label className="thera-field">
                    <span className="thera-field-label">Status</span>
                    <select className="thera-input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as AuthorizationDraft["status"] })}>
                      {statusOptions.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
                    </select>
                  </label>
                  <label className="thera-field">
                    <span className="thera-field-label">Start Date</span>
                    <input className="thera-input" type="date" value={form.startDate ?? ""} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                  </label>
                  <label className="thera-field">
                    <span className="thera-field-label">End Date</span>
                    <input className="thera-input" type="date" value={form.endDate ?? ""} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
                  </label>
                  <label className="thera-field thera-span-2">
                    <span className="thera-field-label">Notes</span>
                    <textarea className="thera-input" rows={5} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                  </label>
                </div>
              </section>

              <section className="thera-card">
                <div className="thera-card-header"><div><h2>Unit Management</h2><p>CPT-level authorized, used, and remaining units are managed in Patient 360.</p></div></div>
                <div className="thera-definition-grid">
                  <Field label="Current Remaining Units" value={activeRow.remainingUnits === null ? "Not unit-based / not entered" : String(activeRow.remainingUnits)} />
                  <Field label="Current Alert" value={activeRow.alert.replaceAll("_", " ")} />
                </div>
                <button type="button" className="thera-action secondary" style={{ marginTop: 14 }} onClick={() => navigate(`/clients/${activeRow.patientId}`)}>
                  Open Patient 360 for CPT Units
                </button>
              </section>
            </div>
          )}
        </WorkDrawer>
      )}
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <div className="thera-field"><span className="thera-field-label">{label}</span><div>{value}</div></div>;
}
