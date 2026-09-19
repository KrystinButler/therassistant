import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { WorkDrawer } from "../../components/work-drawer";
import { shortDate } from "../../lib/format";
import {
  createAuthorization,
  getAuthorizationWorkspace,
  setAuthorizationUnits,
  updateAuthorization,
} from "../authorizations/repository";
import type {
  AuthorizationDraft,
  AuthorizationUnitDraft,
} from "../authorizations/workflow";
import { getAuthorizationQueueData } from "./repository";

type AuthorizationRow = Awaited<ReturnType<typeof getAuthorizationQueueData>>[number];

type UnitForm = {
  key: string;
  cptCode: string;
  authorizedUnits: number;
  usedUnits: number;
};

type AuthorizationForm = {
  authorizationId: string | null;
  patientId: string;
  patientName: string;
  payerId: string;
  payerName: string;
  authorizationNumber: string;
  status: AuthorizationDraft["status"];
  startDate: string;
  endDate: string;
  notes: string;
  units: UnitForm[];
};

const statuses: AuthorizationDraft["status"][] = [
  "not_required",
  "pending",
  "approved",
  "denied",
  "expired",
  "exhausted",
  "cancelled",
  "unknown",
];

function emptyUnit(index = 0): UnitForm {
  return {
    key: `new-${Date.now()}-${index}`,
    cptCode: "",
    authorizedUnits: 0,
    usedUnits: 0,
  };
}

function newForm(row: AuthorizationRow): AuthorizationForm {
  return {
    authorizationId: null,
    patientId: row.patientId,
    patientName: row.patientName,
    payerId: row.payerId ?? "",
    payerName: row.payerName,
    authorizationNumber: "",
    status: "pending",
    startDate: "",
    endDate: "",
    notes: "",
    units: [emptyUnit()],
  };
}

export function AuthorizationsPage() {
  const [, navigate] = useLocation();
  const [rows, setRows] = useState<AuthorizationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [form, setForm] = useState<AuthorizationForm | null>(null);
  const [baseline, setBaseline] = useState<AuthorizationForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

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
  const dirty = Boolean(form && baseline && JSON.stringify(form) !== JSON.stringify(baseline));

  function setOpenForm(next: AuthorizationForm) {
    setForm(next);
    setBaseline(JSON.parse(JSON.stringify(next)) as AuthorizationForm);
    setError(null);
    setMessage(null);
  }

  async function openRow(row: AuthorizationRow) {
    if (!row.authorizationId) {
      setOpenForm(newForm(row));
      return;
    }

    setOpeningId(row.id);
    setError(null);
    try {
      const workspace = await getAuthorizationWorkspace(row.patientId);
      const authorization = workspace.find((item) => item.id === row.authorizationId);
      if (!authorization) throw new Error("Authorization record was not found.");

      const units = Array.isArray(authorization.units)
        ? authorization.units.map((unit, index) => ({
            key: String(unit.id ?? `unit-${index}`),
            cptCode: String(unit.cpt_code ?? ""),
            authorizedUnits: Number(unit.authorized_units ?? 0),
            usedUnits: Number(unit.used_units ?? 0),
          }))
        : [];

      setOpenForm({
        authorizationId: authorization.id,
        patientId: row.patientId,
        patientName: row.patientName,
        payerId: String(authorization.payer_id ?? row.payerId ?? ""),
        payerName: row.payerName,
        authorizationNumber: String(authorization.authorization_number ?? ""),
        status: String(authorization.status ?? "unknown") as AuthorizationDraft["status"],
        startDate: String(authorization.start_date ?? ""),
        endDate: String(authorization.end_date ?? ""),
        notes: String(authorization.notes ?? ""),
        units: units.length ? units : [emptyUnit()],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open authorization.");
    } finally {
      setOpeningId(null);
    }
  }

  function updateUnit(key: string, values: Partial<UnitForm>) {
    setForm((current) => current
      ? {
          ...current,
          units: current.units.map((unit) => unit.key === key ? { ...unit, ...values } : unit),
        }
      : current);
  }

  function addUnit() {
    setForm((current) => current
      ? { ...current, units: [...current.units, emptyUnit(current.units.length)] }
      : current);
  }

  function removeUnsavedUnit(key: string) {
    setForm((current) => {
      if (!current) return current;
      const next = current.units.filter((unit) => unit.key !== key);
      return { ...current, units: next.length ? next : [emptyUnit()] };
    });
  }

  async function save() {
    if (!form) return;
    if (!form.payerId) {
      setError("Select a payer before saving the authorization.");
      return;
    }
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      setError("Authorization end date cannot be before the start date.");
      return;
    }

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

      const authorization = form.authorizationId
        ? await updateAuthorization(form.authorizationId, draft)
        : await createAuthorization(form.patientId, draft);

      if (form.status !== "not_required") {
        const unitRows = form.units.filter((unit) => unit.cptCode.trim() || unit.authorizedUnits > 0 || unit.usedUnits > 0);
        for (const unit of unitRows) {
          const input: AuthorizationUnitDraft = {
            cptCode: unit.cptCode.trim() || undefined,
            authorizedUnits: unit.authorizedUnits,
            usedUnits: unit.usedUnits,
          };
          await setAuthorizationUnits(authorization.id, input);
        }
      }

      setForm(null);
      setBaseline(null);
      setMessage("Authorization saved. Scheduling and billing readiness will use the updated status and units.");
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
          <p>Resolve missing approvals, maintain authorization periods, and track CPT-level units used by scheduling and billing readiness.</p>
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
                    <td>
                      <button type="button" className="thera-table-link" onClick={() => navigate(`/clients/${row.patientId}`)}>
                        {row.patientName}
                      </button>
                    </td>
                    <td>{row.payerName}</td>
                    <td>{row.authorizationNumber || "—"}</td>
                    <td><StatusBadge value={row.status} /></td>
                    <td>{row.endDate ? shortDate(row.endDate) : "—"}</td>
                    <td>{row.remainingUnits ?? "—"}</td>
                    <td><StatusBadge value={row.alert} /></td>
                    <td>
                      <div className="thera-filter-row">
                        <button
                          type="button"
                          className={row.needsAttention ? "thera-action" : "thera-action secondary"}
                          disabled={openingId === row.id}
                          onClick={() => void openRow(row)}
                        >
                          {openingId === row.id
                            ? "Opening..."
                            : row.authorizationId
                              ? "Work Authorization"
                              : "Add Authorization"}
                        </button>
                        <button type="button" className="thera-action secondary" onClick={() => navigate(`/clients/${row.patientId}`)}>
                          Patient Chart
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={8}><div className="thera-empty">No authorization records match this view.</div></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {form && (
        <WorkDrawer
          open={Boolean(form)}
          onOpenChange={(open) => {
            if (!open) {
              setForm(null);
              setBaseline(null);
            }
          }}
          dirty={dirty}
          title={form.authorizationId ? "Work Authorization" : "Add Authorization"}
          subtitle={`${form.patientName} · ${form.payerName}`}
          badges={<StatusBadge value={form.status} />}
          openFullRecord={() => navigate(`/clients/${form.patientId}`)}
          openFullRecordLabel="Open Patient Chart"
          footer={
            <div className="thera-filter-row" style={{ justifyContent: "space-between", width: "100%" }}>
              <button
                type="button"
                className="thera-action secondary"
                onClick={() => {
                  setForm(null);
                  setBaseline(null);
                }}
              >
                Cancel
              </button>
              <button type="button" className="thera-action" disabled={saving || !form.payerId} onClick={() => void save()}>
                {saving ? "Saving..." : "Save Authorization"}
              </button>
            </div>
          }
        >
          <div className="thera-stack">
            <section className="thera-card">
              <div className="thera-card-header">
                <div><h2>Authorization</h2><p>Approval number, status, and effective period.</p></div>
              </div>
              <div className="thera-form-grid">
                <label className="thera-field">
                  <span className="thera-field-label">Payer</span>
                  <input className="thera-input" value={form.payerName} disabled />
                </label>
                <label className="thera-field">
                  <span className="thera-field-label">Authorization Number</span>
                  <input className="thera-input" value={form.authorizationNumber} onChange={(e) => setForm({ ...form, authorizationNumber: e.target.value })} />
                </label>
                <label className="thera-field">
                  <span className="thera-field-label">Status</span>
                  <select className="thera-input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as AuthorizationDraft["status"] })}>
                    {statuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
                  </select>
                </label>
                <label className="thera-field">
                  <span className="thera-field-label">Start Date</span>
                  <input className="thera-input" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                </label>
                <label className="thera-field">
                  <span className="thera-field-label">End Date</span>
                  <input className="thera-input" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
                </label>
                <label className="thera-field thera-span-2">
                  <span className="thera-field-label">Notes</span>
                  <textarea className="thera-input" rows={4} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </label>
              </div>
            </section>

            {form.status !== "not_required" && (
              <section className="thera-card">
                <div className="thera-card-header split">
                  <div><h2>Authorized Services</h2><p>Track units by CPT or HCPCS code.</p></div>
                  <button type="button" className="thera-action secondary" onClick={addUnit}>+ Add Service</button>
                </div>
                <div className="thera-stack">
                  {form.units.map((unit) => {
                    const remaining = Math.max(0, Number(unit.authorizedUnits) - Number(unit.usedUnits));
                    const persisted = !unit.key.startsWith("new-");
                    return (
                      <div className="thera-card" key={unit.key}>
                        <div className="thera-form-grid">
                          <label className="thera-field">
                            <span className="thera-field-label">CPT / HCPCS</span>
                            <input className="thera-input" value={unit.cptCode} onChange={(e) => updateUnit(unit.key, { cptCode: e.target.value })} placeholder="90837" />
                          </label>
                          <label className="thera-field">
                            <span className="thera-field-label">Authorized Units</span>
                            <input className="thera-input" type="number" min="0" step="1" value={unit.authorizedUnits} onChange={(e) => updateUnit(unit.key, { authorizedUnits: Number(e.target.value) })} />
                          </label>
                          <label className="thera-field">
                            <span className="thera-field-label">Used Units</span>
                            <input className="thera-input" type="number" min="0" step="1" value={unit.usedUnits} onChange={(e) => updateUnit(unit.key, { usedUnits: Number(e.target.value) })} />
                          </label>
                          <div className="thera-field">
                            <span className="thera-field-label">Remaining Units</span>
                            <div className="thera-input" style={{ display: "flex", alignItems: "center" }}>{remaining}</div>
                          </div>
                        </div>
                        {!persisted && form.units.length > 1 && (
                          <div style={{ marginTop: 10 }}>
                            <button type="button" className="thera-action secondary" onClick={() => removeUnsavedUnit(unit.key)}>Remove Service</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <section className="thera-card">
              <h2>Readiness Effect</h2>
              <p>
                Approved, unexpired authorizations with remaining units allow required services to pass pre-session and billing readiness.
                Pending, denied, expired, exhausted, or missing authorizations remain blocking issues.
              </p>
            </section>
          </div>
        </WorkDrawer>
      )}
    </>
  );
}
