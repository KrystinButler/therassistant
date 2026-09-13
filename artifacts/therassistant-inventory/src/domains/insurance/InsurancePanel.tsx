import { useEffect, useMemo, useState } from "react";

import { StatusBadge } from "../../components/status-badge";
import { money, shortDate } from "../../lib/format";
import type { PatientChart } from "../patients/types";
import { runPatientEligibility } from "../eligibility/repository";
import { parseEligibilityBenefits } from "../eligibility/workflow";
import { getInsuranceOptions } from "./repository";
import {
  addInsurancePolicy,
  setPrimaryInsurance,
  terminateInsurancePolicy,
  updateInsurancePolicy,
  type InsuranceDraft,
} from "./workflow";

type OptionRow = Record<string, unknown> & { id: string };

type FormState = InsuranceDraft & { id?: string };
const emptyForm: FormState = {
  payerId: "",
  payerPlanId: "",
  insuranceOrder: "primary",
  status: "active",
  memberId: "",
  groupNumber: "",
  subscriberName: "",
  subscriberDob: "",
  relationshipToSubscriber: "self",
  effectiveDate: "",
  terminationDate: "",
  authorizationRequired: false,
};

export function InsurancePanel({ chart, onChanged }: { chart: PatientChart; onChanged: () => Promise<void> }) {
  const [options, setOptions] = useState<{ payers: OptionRow[]; plans: OptionRow[] }>({ payers: [], plans: [] });
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void getInsuranceOptions().then(setOptions).catch(() => undefined); }, []);

  const eligiblePlans = useMemo(
    () => options.plans.filter((plan) => !form.payerId || String(plan.payer_id ?? "") === form.payerId),
    [options.plans, form.payerId],
  );

  function edit(row: Record<string, unknown> & { id: string }) {
    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};
    setForm({
      id: row.id,
      payerId: String(row.payer_id ?? ""),
      payerPlanId: String(row.payer_plan_id ?? ""),
      insuranceOrder: (String(row.insurance_order ?? "primary") as InsuranceDraft["insuranceOrder"]),
      status: (String(row.status ?? "active") as InsuranceDraft["status"]),
      memberId: String(row.member_id ?? ""),
      groupNumber: String(row.group_number ?? ""),
      subscriberName: String(row.subscriber_name ?? ""),
      subscriberDob: String(row.subscriber_dob ?? ""),
      relationshipToSubscriber: String(row.relationship_to_subscriber ?? "self"),
      effectiveDate: String(row.effective_date ?? ""),
      terminationDate: String(row.termination_date ?? ""),
      authorizationRequired: metadata.authorization_required === true,
    });
    setShowForm(true);
  }

  async function save() {
    setSaving(true); setError(null);
    try {
      if (form.id) await updateInsurancePolicy(form.id, form);
      else await addInsurancePolicy(chart.patient.id, form);
      setShowForm(false); setForm(emptyForm); await onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to save insurance policy."); }
    finally { setSaving(false); }
  }

  async function makePrimary(id: string) {
    setError(null);
    try { await setPrimaryInsurance(chart.patient.id, id); await onChanged(); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to change primary insurance."); }
  }

  async function terminate(id: string) {
    const date = window.prompt("Termination date (YYYY-MM-DD):", new Date().toISOString().slice(0, 10));
    if (!date) return;
    setError(null);
    try { await terminateInsurancePolicy(id, date); await onChanged(); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to terminate insurance."); }
  }

  async function runEligibility(policy: Record<string, unknown> & { id: string }) {
    setRunningId(policy.id); setError(null);
    try {
      await runPatientEligibility({
        patientId: chart.patient.id,
        policyId: policy.id,
        payerId: String(policy.payer_id ?? ""),
        memberId: String(policy.member_id ?? ""),
        serviceDate: new Date().toISOString().slice(0, 10),
      });
      await onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to run eligibility."); }
    finally { setRunningId(null); }
  }

  return <div className="thera-detail-grid">
    <section className="thera-card thera-span-2">
      <div className="thera-card-header split"><div><h2>Insurance Policies</h2><p>Primary, secondary, and other coverage used by scheduling and billing readiness.</p></div><button type="button" className="thera-action" onClick={() => { setForm(emptyForm); setShowForm(true); }}>+ Add Policy</button></div>
      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {showForm && <div className="thera-form-grid" style={{ marginBottom: 18 }}>
        <label className="thera-field"><span className="thera-field-label">Payer</span><select className="thera-input" value={form.payerId} onChange={(e) => setForm({ ...form, payerId: e.target.value, payerPlanId: "" })}><option value="">Select payer</option>{options.payers.map((row) => <option key={row.id} value={row.id}>{String(row.name ?? "Unnamed payer")}</option>)}</select></label>
        <label className="thera-field"><span className="thera-field-label">Plan / Product</span><select className="thera-input" value={form.payerPlanId ?? ""} onChange={(e) => setForm({ ...form, payerPlanId: e.target.value })}><option value="">No specific plan</option>{eligiblePlans.map((row) => <option key={row.id} value={row.id}>{String(row.name ?? "Unnamed plan")}</option>)}</select></label>
        <Text label="Member ID" value={form.memberId} onChange={(memberId) => setForm({ ...form, memberId })} />
        <Text label="Group Number" value={form.groupNumber ?? ""} onChange={(groupNumber) => setForm({ ...form, groupNumber })} />
        <Text label="Subscriber Name" value={form.subscriberName ?? ""} onChange={(subscriberName) => setForm({ ...form, subscriberName })} />
        <Text label="Subscriber DOB" type="date" value={form.subscriberDob ?? ""} onChange={(subscriberDob) => setForm({ ...form, subscriberDob })} />
        <Text label="Relationship" value={form.relationshipToSubscriber ?? ""} onChange={(relationshipToSubscriber) => setForm({ ...form, relationshipToSubscriber })} />
        <Text label="Effective Date" type="date" value={form.effectiveDate ?? ""} onChange={(effectiveDate) => setForm({ ...form, effectiveDate })} />
        <Select label="Order" value={form.insuranceOrder ?? "primary"} options={["primary","secondary","tertiary","other"]} onChange={(insuranceOrder) => setForm({ ...form, insuranceOrder: insuranceOrder as InsuranceDraft["insuranceOrder"] })} />
        <Select label="Status" value={form.status ?? "active"} options={["active","inactive","pending_verification","terminated","unknown"]} onChange={(status) => setForm({ ...form, status: status as InsuranceDraft["status"] })} />
        <label><input type="checkbox" checked={form.authorizationRequired === true} onChange={(e) => setForm({ ...form, authorizationRequired: e.target.checked })} /> Authorization required</label>
        <div className="thera-span-2 thera-filter-row"><button type="button" className="thera-action" disabled={saving} onClick={() => void save()}>{saving ? "Saving..." : "Save Policy"}</button><button type="button" className="thera-action secondary" onClick={() => setShowForm(false)}>Cancel</button></div>
      </div>}
      {chart.insurancePolicies.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Order</th><th>Payer / Plan</th><th>Member</th><th>Effective</th><th>Status</th><th>Actions</th></tr></thead><tbody>{chart.insurancePolicies.map((row) => <tr key={row.id}><td>{String(row.insurance_order ?? "—")}</td><td><strong>{String(row.payerName ?? "—")}</strong><div className="thera-table-subtext">{String(row.planName ?? "—")}</div></td><td>{String(row.member_id ?? "—")}</td><td>{shortDate(String(row.effective_date ?? ""))} – {row.termination_date ? shortDate(String(row.termination_date)) : "Current"}</td><td><StatusBadge value={String(row.status ?? "unknown")} /></td><td><div className="thera-filter-row"><button className="thera-action secondary" type="button" onClick={() => edit(row)}>Edit</button>{row.insurance_order !== "primary" && row.status === "active" && <button className="thera-action secondary" type="button" onClick={() => void makePrimary(row.id)}>Make Primary</button>}<button className="thera-action secondary" type="button" disabled={runningId === row.id || row.status === "terminated"} onClick={() => void runEligibility(row)}>{runningId === row.id ? "Running..." : "Run Eligibility"}</button>{row.status !== "terminated" && <button className="thera-action secondary" type="button" onClick={() => void terminate(row.id)}>Terminate</button>}</div></td></tr>)}</tbody></table></div> : <div className="thera-empty">No insurance policies. Add coverage before scheduling payer-based services.</div>}
    </section>
    <EligibilityHistory rows={chart.eligibilityHistory} />
  </div>;
}

function EligibilityHistory({ rows }: { rows: PatientChart["eligibilityHistory"] }) {
  return <section className="thera-card thera-span-2"><div className="thera-card-header"><div><h2>Eligibility History</h2><p>Saved synthetic 270/271 responses and benefit details.</p></div></div>{rows.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Service Date</th><th>Payer</th><th>Status</th><th>Copay</th><th>Coinsurance</th><th>Deductible Remaining</th><th>OOP Remaining</th><th>Network</th><th>Source</th></tr></thead><tbody>{rows.map((row) => { const benefits = parseEligibilityBenefits(row.raw_response); return <tr key={row.id}><td>{shortDate(String(row.service_date ?? ""))}</td><td>{String(row.payerName ?? "—")}</td><td><StatusBadge value={String(row.eligibility_status ?? "unknown")} /></td><td>{benefits.copayCents === null ? "—" : money(benefits.copayCents)}</td><td>{benefits.coinsurancePercent === null ? "—" : `${benefits.coinsurancePercent}%`}</td><td>{benefits.deductibleRemainingCents === null ? "—" : money(benefits.deductibleRemainingCents)}</td><td>{benefits.outOfPocketRemainingCents === null ? "—" : money(benefits.outOfPocketRemainingCents)}</td><td>{benefits.networkStatus.replaceAll("_", " ")}</td><td>{String(row.response_source ?? "—")}</td></tr>; })}</tbody></table></div> : <div className="thera-empty">No eligibility history yet. Run eligibility from an active policy.</div>}</section>;
}

function Text({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) { return <label className="thera-field"><span className="thera-field-label">{label}</span><input className="thera-input" type={type} value={value} onChange={(e) => onChange(e.target.value)} /></label>; }
function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) { return <label className="thera-field"><span className="thera-field-label">{label}</span><select className="thera-input" value={value} onChange={(e) => onChange(e.target.value)}>{options.map((option) => <option key={option} value={option}>{option.replaceAll("_", " ")}</option>)}</select></label>; }
