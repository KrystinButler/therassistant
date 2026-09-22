import { useEffect, useState } from "react";

import { StatusBadge } from "../../components/status-badge";
import { TreatmentPlanReviewCard } from "./TreatmentPlanReviewCard";
import { shortDate } from "../../lib/format";
import type { PatientChart } from "../patients/types";
import {
  addTreatmentGoal,
  createTreatmentPlan,
  getTreatmentPlanOptions,
  getTreatmentPlanReviews,
  generateTreatmentPlanReview,
  updateTreatmentGoal,
  updateTreatmentPlan,
} from "./repository";
import {
  treatmentPlanAlert,
  type TreatmentGoalDraft,
  type TreatmentPlanDraft,
} from "./workflow";

type Provider = Record<string, unknown> & { id: string };
type PlanForm = TreatmentPlanDraft & { id?: string };
const blankPlan: PlanForm = { providerId: "", status: "draft", effectiveDate: "", reviewDueDate: "", problemStatement: "", planText: "", interventions: "" };
const blankGoal: TreatmentGoalDraft = { goalText: "", objectiveText: "", status: "active" };

function name(row: Record<string, unknown>) { return [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unnamed provider"; }

export function TreatmentPlanPanel({ chart, onChanged }: { chart: PatientChart; onChanged: () => Promise<void> }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [form, setForm] = useState<PlanForm>(blankPlan);
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [goalPlanId, setGoalPlanId] = useState<string | null>(null);
  const [goalId, setGoalId] = useState<string | null>(null);
  const [goalForm, setGoalForm] = useState<TreatmentGoalDraft>(blankGoal);
  const [reviews, setReviews] = useState<Array<Record<string, unknown> & { id: string; goals?: Array<Record<string, unknown> & { id: string }> }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void getTreatmentPlanOptions().then(setProviders).catch(() => undefined); }, []);

  async function loadReviews() {
    try {
      setReviews(await getTreatmentPlanReviews(chart.patient.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load treatment-plan reviews.");
    }
  }

  useEffect(() => { void loadReviews(); }, [chart.patient.id]);

  async function refreshAfterReviewChange() {
    await Promise.all([onChanged(), loadReviews()]);
  }

  async function generateReview(planId: string) {
    setSaving(true);
    setError(null);
    try {
      await generateTreatmentPlanReview(planId);
      await loadReviews();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate 90-day review draft.");
    } finally {
      setSaving(false);
    }
  }

  function editPlan(row: Record<string, unknown> & { id: string }) {
    setForm({
      id: row.id,
      providerId: String(row.provider_id ?? ""),
      status: String(row.status ?? "draft") as TreatmentPlanDraft["status"],
      effectiveDate: String(row.effective_date ?? ""),
      reviewDueDate: String(row.review_due_date ?? ""),
      problemStatement: String(row.problem_statement ?? ""),
      planText: String(row.plan_text ?? ""),
      interventions: String(row.interventions ?? ""),
    });
    setShowPlanForm(true);
  }

  async function savePlan() {
    setSaving(true); setError(null);
    try {
      if (form.id) await updateTreatmentPlan(form.id, form);
      else await createTreatmentPlan(chart.patient.id, form);
      setForm(blankPlan); setShowPlanForm(false); await onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to save treatment plan."); }
    finally { setSaving(false); }
  }

  function beginGoal(planId: string, goal?: Record<string, unknown> & { id: string }) {
    setGoalPlanId(planId); setGoalId(goal?.id ?? null);
    setGoalForm(goal ? { goalText: String(goal.goal_text ?? ""), objectiveText: String(goal.objective_text ?? ""), status: String(goal.status ?? "active") } : blankGoal);
  }

  async function saveGoal() {
    if (!goalPlanId) return;
    setSaving(true); setError(null);
    try {
      if (goalId) await updateTreatmentGoal(goalId, goalForm);
      else await addTreatmentGoal(goalPlanId, goalForm);
      setGoalPlanId(null); setGoalId(null); setGoalForm(blankGoal); await onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to save treatment goal."); }
    finally { setSaving(false); }
  }

  return <section className="thera-card">
    <div className="thera-card-header split"><div><h2>Treatment Plans & Goals</h2><p>Clinical plan, measurable goals, interventions, and review deadlines tied to encounter readiness.</p></div><button type="button" className="thera-action" onClick={() => { setForm(blankPlan); setShowPlanForm(true); }}>+ New Treatment Plan</button></div>
    {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
    {showPlanForm && <div className="thera-form-grid" style={{ marginBottom: 20 }}>
      <label className="thera-field"><span className="thera-field-label">Responsible Provider</span><select className="thera-input" value={form.providerId} onChange={(e) => setForm({ ...form, providerId: e.target.value })}><option value="">Select provider</option>{providers.map((row) => <option key={row.id} value={row.id}>{name(row)}</option>)}</select></label>
      <Select label="Status" value={form.status} options={["draft","active","under_review","expired","discontinued","superseded","signed"]} onChange={(status) => setForm({ ...form, status: status as TreatmentPlanDraft["status"] })} />
      <Text label="Effective Date" type="date" value={form.effectiveDate ?? ""} onChange={(effectiveDate) => setForm({ ...form, effectiveDate })} />
      <Text label="Review Due" type="date" value={form.reviewDueDate ?? ""} onChange={(reviewDueDate) => setForm({ ...form, reviewDueDate })} />
      <Area label="Problem Statement" value={form.problemStatement ?? ""} onChange={(problemStatement) => setForm({ ...form, problemStatement })} />
      <Area label="Treatment Plan" value={form.planText} onChange={(planText) => setForm({ ...form, planText })} />
      <Area label="Interventions" value={form.interventions ?? ""} onChange={(interventions) => setForm({ ...form, interventions })} />
      <div className="thera-span-2 thera-filter-row"><button type="button" className="thera-action" disabled={saving} onClick={() => void savePlan()}>{saving ? "Saving..." : "Save Treatment Plan"}</button><button type="button" className="thera-action secondary" onClick={() => setShowPlanForm(false)}>Cancel</button></div>
    </div>}
    {goalPlanId && <div className="thera-form-grid" style={{ marginBottom: 20 }}><Area label="Measurable Goal" value={goalForm.goalText} onChange={(goalText) => setGoalForm({ ...goalForm, goalText })} /><Area label="Objective" value={goalForm.objectiveText ?? ""} onChange={(objectiveText) => setGoalForm({ ...goalForm, objectiveText })} /><Text label="Goal Status" value={goalForm.status ?? "active"} onChange={(status) => setGoalForm({ ...goalForm, status })} /><div className="thera-filter-row"><button type="button" className="thera-action" disabled={saving} onClick={() => void saveGoal()}>{saving ? "Saving..." : "Save Goal"}</button><button type="button" className="thera-action secondary" onClick={() => setGoalPlanId(null)}>Cancel</button></div></div>}
    {chart.treatmentPlans.length ? <div className="thera-stack">{chart.treatmentPlans.map((plan) => {
      const alert = treatmentPlanAlert({ status: String(plan.status ?? "draft"), reviewDueDate: plan.review_due_date ? String(plan.review_due_date) : null });
      const goals = Array.isArray(plan.goals) ? plan.goals : [];
      return <article className="thera-work-card" key={plan.id}><div className="thera-work-card-top"><div><strong>{String(plan.providerName ?? "Treatment Plan")}</strong><div className="thera-table-subtext">Effective {shortDate(String(plan.effective_date ?? ""))} · Review {shortDate(String(plan.review_due_date ?? ""))}</div></div><div><StatusBadge value={String(plan.status ?? "draft")} /> <StatusBadge value={alert.code} /></div></div><div className="thera-definition-grid"><Field label="Problem" value={String(plan.problem_statement ?? "—")} /><Field label="Plan" value={String(plan.plan_text ?? "—")} /><Field label="Interventions" value={String(plan.interventions ?? "—")} /><Field label="Review" value={alert.message} /></div><div style={{ marginTop: 14 }}><div className="thera-row-between"><strong>Goals & Objectives</strong><button type="button" className="thera-action secondary" onClick={() => beginGoal(plan.id)}>+ Add Goal</button></div>{goals.length ? <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Goal</th><th>Objective</th><th>Status</th><th>Action</th></tr></thead><tbody>{goals.map((goal) => <tr key={goal.id}><td>{String(goal.goal_text ?? "—")}</td><td>{String(goal.objective_text ?? "—")}</td><td><StatusBadge value={String(goal.status ?? "active")} /></td><td><button type="button" className="thera-action secondary" onClick={() => beginGoal(plan.id, goal)}>Edit</button></td></tr>)}</tbody></table></div> : <div className="thera-empty">No goals added yet.</div>}</div><div className="thera-filter-row" style={{ marginTop: 12 }}><button type="button" className="thera-action secondary" onClick={() => editPlan(plan)}>Edit Plan</button>{["active","signed"].includes(String(plan.status ?? "")) && <button type="button" className="thera-action" disabled={saving} onClick={() => void generateReview(plan.id)}>Generate 90-Day Review Draft</button>}</div></article>;
    })}</div> : <div className="thera-empty">No treatment plan exists. Add one to connect goals to encounters and clinical documentation.</div>}

    <div style={{ marginTop: 24 }}>
      <div className="thera-card-header">
        <div>
          <div className="thera-eyebrow">LONGITUDINAL REVIEW</div>
          <h2>90-Day Treatment Plan Reviews</h2>
          <p>Evidence drafts summarize charted sessions and score changes. Clinicians choose every goal decision and sign the review.</p>
        </div>
      </div>
      {reviews.length ? <div className="thera-stack">{reviews.map((review) =>
        <TreatmentPlanReviewCard key={review.id} review={review} onChanged={refreshAfterReviewChange} />
      )}</div> : <div className="thera-empty">No 90-day review draft has been generated.</div>}
    </div>
  </section>;
}

function Text({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) { return <label className="thera-field"><span className="thera-field-label">{label}</span><input className="thera-input" type={type} value={value} onChange={(e) => onChange(e.target.value)} /></label>; }
function Area({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="thera-field thera-span-2"><span className="thera-field-label">{label}</span><textarea className="thera-input" rows={3} value={value} onChange={(e) => onChange(e.target.value)} /></label>; }
function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) { return <label className="thera-field"><span className="thera-field-label">{label}</span><select className="thera-input" value={value} onChange={(e) => onChange(e.target.value)}>{options.map((option) => <option key={option} value={option}>{option.replaceAll("_", " ")}</option>)}</select></label>; }
function Field({ label, value }: { label: string; value: string }) { return <div><div className="thera-field-label">{label}</div><div>{value}</div></div>; }
