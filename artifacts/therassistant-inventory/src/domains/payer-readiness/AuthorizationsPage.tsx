import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { WorkDrawer } from "../../components/work-drawer";
import { shortDate } from "../../lib/format";
import {
  createAuthorization,
  getAuthorizationWorkspace,
  recordAuthorizationUse,
  setAuthorizationUnits,
  updateAuthorization,
} from "../authorizations/repository";
import type {
  AuthorizationDraft,
  AuthorizationUnitDraft,
} from "../authorizations/workflow";
import { getAuthorizationQueueData } from "./repository";

type AuthorizationRow = Awaited<ReturnType<typeof getAuthorizationQueueData>>[number];
type WorkspaceRow = Awaited<ReturnType<typeof getAuthorizationWorkspace>>[number];
type UnitRow = Record<string, unknown> & { id: string };

type AuthorizationForm = AuthorizationDraft & {
  authorizationId: string | null;
  patientId: string;
};

type UnitForm = {
  cptCode: string;
  authorizedUnits: number;
  usedUnits: number;
};

const blankUnit: UnitForm = {
  cptCode: "",
  authorizedUnits: 0,
  usedUnits: 0,
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

function formFromQueue(row: AuthorizationRow): AuthorizationForm {
  return {
    authorizationId: row.authorizationId,
    patientId: row.patientId,
    payerId: row.payerId ?? "",
    authorizationNumber: row.authorizationNumber ?? "",
    status: row.authorizationId ? (row.status as AuthorizationDraft["status"]) : "pending",
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
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [unitForm, setUnitForm] = useState<UnitForm>(blankUnit);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingUnits, setSavingUnits] = useState(false);

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

  async function loadWorkspace(row: AuthorizationRow, authorizationId = row.authorizationId) {
    setDrawerLoading(true);
    setError(null);
    try {
      const workspace = await getAuthorizationWorkspace(row.patientId);
      const authorization = authorizationId
        ? workspace.find((item) => item.id === authorizationId) ?? null
        : null;

      if (authorization) {
        const next: AuthorizationForm = {
          authorizationId: authorization.id,
          patientId: row.patientId,
          payerId: String(authorization.payer_id ?? row.payerId ?? ""),
          authorizationNumber: String(authorization.authorization_number ?? ""),
          status: String(authorization.status ?? "pending") as AuthorizationDraft["status"],
          startDate: String(authorization.start_date ?? ""),
          endDate: String(authorization.end_date ?? ""),
          notes: String(authorization.notes ?? ""),
        };
        setForm(next);
        setBaseline({ ...next });
        setUnits(Array.isArray(authorization.units) ? authorization.units as UnitRow[] : []);
      } else {
        const next = formFromQueue(row);
        setForm(next);
        setBaseline({ ...next });
        setUnits([]);
      }
      setUnitForm(blankUnit);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load authorization details.");
    } finally {
      setDrawerLoading(false);
    }
  }

  async function openRow(row: AuthorizationRow) {
    setActiveRow(row);
    setMessage(null);
    await loadWorkspace(row);
  }

  function closeDrawer() {
    setActiveRow(null);
    setForm(null);
    setBaseline(null);
    setUnits([]);
    setUnitForm(blankUnit);
  }

  async function openAt(index: number) {
    const row = visible[index];
    if (row) await openRow(row);
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

      const saved = form.authorizationId
        ? await updateAuthorization(form.authorizationId, draft)
        : await createAuthorization(form.patientId, draft);

      const nextForm = { ...form, authorizationId: saved.id };
      setForm(nextForm);
      setBaseline({ ...nextForm });
      setMessage(form.authorizationId ? "Authorization updated." : "Authorization created.");

      await load();
      await loadWorkspace(activeRow, saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save authorization.");
    } finally {
      setSaving(false);
    }
  }

  function editUnit(unit: UnitRow) {
    setUnitForm({
      cptCode: String(unit.cpt_code ?? ""),
      authorizedUnits: Number(unit.authorized_units ?? 0),
      usedUnits: Number(unit.used_units ?? 0),
    });
  }

  async function saveUnitLine() {
    if (!form?.authorizationId) {
      setError("Save the authorization before adding CPT units.");
      return;
    }
    if (!unitForm.cptCode.trim()) {
      setError("Enter a CPT or HCPCS code.");
      return;
    }

    setSavingUnits(true);
    setError(null);
    setMessage(null);
    try {
      const input: AuthorizationUnitDraft = {
        cptCode: unitForm.cptCode,
        authorizedUnits: unitForm.authorizedUnits,
        usedUnits: unitForm.usedUnits,
      };
      await setAuthorizationUnits(form.authorizationId, input);
      setUnitForm(blankUnit);
      setMessage("Authorization units saved.");
      if (activeRow) {
        await load();
        await loadWorkspace(activeRow, form.authorizationId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save authorization units.");
    } finally {
      setSavingUnits(false);
    }
  }

  async function recordUse(unit: UnitRow) {
    if (!form?.authorizationId) return;
    const remaining = Number(unit.remaining_units ?? 0);
    const requested = window.prompt(
      `Units used for ${String(unit.cpt_code ?? "service")} (remaining: ${remaining}):`,
      "1",
    );
    if (!requested) return;

    const amount = Number(requested);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid number of units greater than zero.");
      return;
    }

    setSavingUnits(true);
    setError(null);
    setMessage(null);
    try {
      await recordAuthorizationUse(
        form.authorizationId,
        String(unit.cpt_code ?? ""),
        amount,
      );
      setMessage("Authorization use recorded.");
      if (activeRow) {
        await load();
        await loadWorkspace(activeRow, form.authorizationId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to record authorization use.");
    } finally {
      setSavingUnits(false);
    }
  }

  return (
    <>
      <div className="thera-page-header split">
        <div>
          <div className="thera-eyebrow">UTILIZATION MANAGEMENT</div>
          <h1>Authorizations</h1>
          <p>Create, update, and work authorization approvals, expiration dates, and CPT-level unit utilization.</p>
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
                  <tr>
                    <td colSpan={8}><div className="thera-empty">No authorization records match this view.</div></td>
                  </tr>
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
          onPrevious={() => void openAt(activeIndex - 1)}
          onNext={() => void openAt(activeIndex + 1)}
          previousDisabled={activeIndex <= 0}
          nextDisabled={activeIndex < 0 || activeIndex >= visible.length - 1}
          openFullRecord={() => navigate(`/clients/${activeRow.patientId}`)}
          openFullRecordLabel="Open Patient 360"
          footer={
            <div className="thera-filter-row" style={{ justifyContent: "space-between", width: "100%" }}>
              <button type="button" className="thera-action secondary" onClick={closeDrawer}>Close</button>
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
                <div className="thera-card-header">
                  <div><h2>Authorization Details</h2><p>Approval and effective-period information used by scheduling and billing readiness.</p></div>
                </div>
                <div className="thera-form-grid">
                  <label className="thera-field">
                    <span className="thera-field-label">Payer *</span>
                    <input className="thera-input" value={activeRow.payerName} disabled />
                  </label>
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
                    <textarea className="thera-input" rows={4} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                  </label>
                </div>
              </section>

              <section className="thera-card">
                <div className="thera-card-header split">
                  <div><h2>CPT / HCPCS Units</h2><p>Track authorized, used, and remaining units by service code.</p></div>
                  <button type="button" className="thera-action secondary" onClick={() => setUnitForm(blankUnit)}>+ New Unit Line</button>
                </div>

                {units.length > 0 ? (
                  <div className="thera-table-wrap" style={{ marginBottom: 16 }}>
                    <table className="thera-table">
                      <thead><tr><th>CPT / HCPCS</th><th>Authorized</th><th>Used</th><th>Remaining</th><th>Actions</th></tr></thead>
                      <tbody>
                        {units.map((unit) => (
                          <tr key={unit.id}>
                            <td><strong>{String(unit.cpt_code ?? "All services")}</strong></td>
                            <td>{Number(unit.authorized_units ?? 0)}</td>
                            <td>{Number(unit.used_units ?? 0)}</td>
                            <td>{Number(unit.remaining_units ?? 0)}</td>
                            <td>
                              <div className="thera-filter-row">
                                <button type="button" className="thera-action secondary" onClick={() => editUnit(unit)}>Edit</button>
                                <button
                                  type="button"
                                  className="thera-action secondary"
                                  disabled={savingUnits || Number(unit.remaining_units ?? 0) <= 0}
                                  onClick={() => void recordUse(unit)}
                                >
                                  Record Use
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="thera-empty" style={{ marginBottom: 16 }}>
                    No CPT-specific unit limits are recorded. This is acceptable when the authorization is not unit-based.
                  </div>
                )}

                <div className="thera-form-grid">
                  <label className="thera-field">
                    <span className="thera-field-label">CPT / HCPCS</span>
                    <input className="thera-input" value={unitForm.cptCode} onChange={(e) => setUnitForm({ ...unitForm, cptCode: e.target.value })} placeholder="90837" />
                  </label>
                  <label className="thera-field">
                    <span className="thera-field-label">Authorized Units</span>
                    <input className="thera-input" type="number" min={0} step={1} value={unitForm.authorizedUnits} onChange={(e) => setUnitForm({ ...unitForm, authorizedUnits: Number(e.target.value) })} />
                  </label>
                  <label className="thera-field">
                    <span className="thera-field-label">Used Units</span>
                    <input className="thera-input" type="number" min={0} step={1} value={unitForm.usedUnits} onChange={(e) => setUnitForm({ ...unitForm, usedUnits: Number(e.target.value) })} />
                  </label>
                  <div className="thera-field" style={{ justifyContent: "end" }}>
                    <span className="thera-field-label">&nbsp;</span>
                    <button
                      type="button"
                      className="thera-action secondary"
                      disabled={savingUnits || !form.authorizationId || !unitForm.cptCode.trim()}
                      onClick={() => void saveUnitLine()}
                    >
                      {savingUnits ? "Saving..." : "Save Unit Line"}
                    </button>
                  </div>
                </div>
              </section>

              <section className="thera-card">
                <div className="thera-card-header"><div><h2>Workflow Impact</h2><p>These authorization records feed the same readiness checks used elsewhere in Therassistant.</p></div></div>
                <div className="thera-definition-grid">
                  <Impact label="Schedule" value="Blocks encounter start when a required authorization is missing, denied, expired, or exhausted." />
                  <Impact label="Billing" value="Routes authorization failures to billing hold and creates follow-up work instead of releasing a charge." />
                </div>
              </section>
            </div>
          )}
        </WorkDrawer>
      )}
    </>
  );
}

function Impact({ label, value }: { label: string; value: string }) {
  return <div><div className="thera-field-label">{label}</div><div>{value}</div></div>;
}
