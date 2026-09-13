import { useState } from "react";

import { StatusBadge } from "../../components/status-badge";
import { shortDate } from "../../lib/format";
import type { PatientChart } from "../patients/types";
import {
  createAuthorization,
  recordAuthorizationUse,
  setAuthorizationUnits,
  updateAuthorization,
} from "./repository";
import { authorizationAlert, type AuthorizationDraft } from "./workflow";

type AuthForm = AuthorizationDraft & { id?: string; cptCode: string; authorizedUnits: number; usedUnits: number };
const blank: AuthForm = { payerId: "", authorizationNumber: "", status: "approved", startDate: "", endDate: "", notes: "", cptCode: "90837", authorizedUnits: 0, usedUnits: 0 };

export function AuthorizationPanel({ chart, onChanged }: { chart: PatientChart; onChanged: () => Promise<void> }) {
  const [form, setForm] = useState<AuthForm>(blank);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const payerOptions = Array.from(new Map(chart.insurancePolicies.filter((row) => row.payer_id).map((row) => [String(row.payer_id), String(row.payerName ?? "Payer")])).entries());

  function edit(row: Record<string, unknown> & { id: string }) {
    const firstUnit = Array.isArray(row.units) ? (row.units[0] as Record<string, unknown> | undefined) : undefined;
    setForm({
      id: row.id,
      payerId: String(row.payer_id ?? ""),
      authorizationNumber: String(row.authorization_number ?? ""),
      status: String(row.status ?? "approved") as AuthorizationDraft["status"],
      startDate: String(row.start_date ?? ""),
      endDate: String(row.end_date ?? ""),
      notes: String(row.notes ?? ""),
      cptCode: String(firstUnit?.cpt_code ?? "90837"),
      authorizedUnits: Number(firstUnit?.authorized_units ?? 0),
      usedUnits: Number(firstUnit?.used_units ?? 0),
    });
    setShowForm(true);
  }

  async function save() {
    setSaving(true); setError(null);
    try {
      const auth = form.id
        ? await updateAuthorization(form.id, form)
        : await createAuthorization(chart.patient.id, form);
      if (form.status !== "not_required" && form.authorizedUnits >= 0 && form.cptCode) {
        await setAuthorizationUnits(auth.id, { cptCode: form.cptCode, authorizedUnits: form.authorizedUnits, usedUnits: form.usedUnits });
      }
      setForm(blank); setShowForm(false); await onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to save authorization."); }
    finally { setSaving(false); }
  }

  async function recordUse(row: Record<string, unknown> & { id: string }, unit: Record<string, unknown>) {
    const requested = window.prompt(`Units to use for ${String(unit.cpt_code ?? "service")}:`, "1");
    if (!requested) return;
    setError(null);
    try {
      await recordAuthorizationUse(row.id, String(unit.cpt_code ?? ""), Number(requested));
      await onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to record authorization use."); }
  }

  return <section className="thera-card">
    <div className="thera-card-header split"><div><h2>Authorizations</h2><p>Track payer approval periods and CPT-level unit utilization.</p></div><button type="button" className="thera-action" onClick={() => { setForm(blank); setShowForm(true); }}>+ Add Authorization</button></div>
    {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
    {showForm && <div className="thera-form-grid" style={{ marginBottom: 18 }}>
      <label className="thera-field"><span className="thera-field-label">Payer</span><select className="thera-input" value={form.payerId} onChange={(e) => setForm({ ...form, payerId: e.target.value })}><option value="">Select payer</option>{payerOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <Text label="Authorization Number" value={form.authorizationNumber ?? ""} onChange={(authorizationNumber) => setForm({ ...form, authorizationNumber })} />
      <Select label="Status" value={form.status} options={["not_required","pending","approved","denied","expired","exhausted","cancelled","unknown"]} onChange={(status) => setForm({ ...form, status: status as AuthorizationDraft["status"] })} />
      <Text label="Start Date" type="date" value={form.startDate ?? ""} onChange={(startDate) => setForm({ ...form, startDate })} />
      <Text label="End Date" type="date" value={form.endDate ?? ""} onChange={(endDate) => setForm({ ...form, endDate })} />
      <Text label="CPT / HCPCS" value={form.cptCode} onChange={(cptCode) => setForm({ ...form, cptCode })} />
      <NumberField label="Authorized Units" value={form.authorizedUnits} onChange={(authorizedUnits) => setForm({ ...form, authorizedUnits })} />
      <NumberField label="Used Units" value={form.usedUnits} onChange={(usedUnits) => setForm({ ...form, usedUnits })} />
      <label className="thera-field thera-span-2"><span className="thera-field-label">Notes</span><textarea className="thera-input" value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
      <div className="thera-span-2 thera-filter-row"><button type="button" className="thera-action" disabled={saving} onClick={() => void save()}>{saving ? "Saving..." : "Save Authorization"}</button><button type="button" className="thera-action secondary" onClick={() => setShowForm(false)}>Cancel</button></div>
    </div>}
    {chart.authorizations.length ? <div className="thera-stack">{chart.authorizations.map((row) => {
      const units = Array.isArray(row.units) ? row.units as Array<Record<string, unknown> & { id: string }> : [];
      const remaining = units.reduce((sum, unit) => sum + Number(unit.remaining_units ?? 0), 0);
      const alert = authorizationAlert({ status: String(row.status ?? "unknown"), endDate: row.end_date ? String(row.end_date) : null, remainingUnits: units.length ? remaining : null });
      return <article className="thera-work-card" key={row.id}><div className="thera-work-card-top"><div><strong>{String(row.payerName ?? "Payer")}</strong><div className="thera-table-subtext">{String(row.authorization_number ?? "No authorization number")}</div></div><div><StatusBadge value={String(row.status ?? "unknown")} /> <StatusBadge value={alert.code} /></div></div><div className="thera-definition-grid"><Field label="Effective" value={shortDate(String(row.start_date ?? ""))} /><Field label="Expires" value={shortDate(String(row.end_date ?? ""))} /><Field label="Remaining Units" value={units.length ? remaining : "—"} /><Field label="Alert" value={alert.message} /></div>{units.length > 0 && <div className="thera-table-wrap" style={{ marginTop: 12 }}><table className="thera-table"><thead><tr><th>CPT</th><th>Authorized</th><th>Used</th><th>Remaining</th><th>Action</th></tr></thead><tbody>{units.map((unit) => <tr key={unit.id}><td>{String(unit.cpt_code ?? "All services")}</td><td>{String(unit.authorized_units ?? 0)}</td><td>{String(unit.used_units ?? 0)}</td><td>{String(unit.remaining_units ?? 0)}</td><td><button type="button" className="thera-action secondary" disabled={Number(unit.remaining_units ?? 0) <= 0} onClick={() => void recordUse(row, unit)}>Record Use</button></td></tr>)}</tbody></table></div>}<div className="thera-filter-row" style={{ marginTop: 12 }}><button type="button" className="thera-action secondary" onClick={() => edit(row)}>Edit Authorization</button></div></article>;
    })}</div> : <div className="thera-empty">No authorizations on file.</div>}
  </section>;
}

function Text({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) { return <label className="thera-field"><span className="thera-field-label">{label}</span><input className="thera-input" type={type} value={value} onChange={(e) => onChange(e.target.value)} /></label>; }
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <label className="thera-field"><span className="thera-field-label">{label}</span><input className="thera-input" type="number" min="0" step="1" value={value} onChange={(e) => onChange(Number(e.target.value))} /></label>; }
function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) { return <label className="thera-field"><span className="thera-field-label">{label}</span><select className="thera-input" value={value} onChange={(e) => onChange(e.target.value)}>{options.map((option) => <option key={option} value={option}>{option.replaceAll("_", " ")}</option>)}</select></label>; }
function Field({ label, value }: { label: string; value: unknown }) { return <div><div className="thera-field-label">{label}</div><div>{String(value)}</div></div>; }
