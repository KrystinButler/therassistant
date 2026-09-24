import { useEffect, useState, type FormEvent } from "react";
import {
  addTreatmentGoal,
  createTreatmentPlan,
  getTreatmentPlanOptions,
} from "./repository";
import type { TreatmentPlanDraft } from "./workflow";
import "./encounter-plan-composer.css";

type Provider = { id: string; first_name?: unknown; last_name?: unknown; credentials?: unknown };
type Props = {
  mode: "plan" | "goal";
  existingPlanId?: string;
  patientId: string;
  defaultProviderId: string;
  serviceDate: string;
  onCancel: () => void;
  onPlanPersisted: (planId: string) => Promise<void>;
  onSaved: (planId: string, goalText?: string) => Promise<void>;
};

export function EncounterTreatmentPlanComposer({
  mode, existingPlanId, patientId, defaultProviderId, serviceDate, onCancel, onPlanPersisted, onSaved,
}: Props) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState(defaultProviderId);
  const [planText, setPlanText] = useState("");
  const [problem, setProblem] = useState("");
  const [interventions, setInterventions] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(serviceDate);
  const [reviewDueDate, setReviewDueDate] = useState("");
  const [goalText, setGoalText] = useState("");
  const [objectiveText, setObjectiveText] = useState("");
  const [createdPlanId, setCreatedPlanId] = useState<string | null>(null);
  const [savedGoalId, setSavedGoalId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "plan") return;
    let mounted = true;
    void getTreatmentPlanOptions()
      .then((rows) => { if (mounted) setProviders(rows as Provider[]); })
      .catch((err: unknown) => { if (mounted && !defaultProviderId) setError(err instanceof Error ? err.message : "Unable to load providers."); });
    return () => { mounted = false; };
  }, [mode, defaultProviderId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const goal = goalText.trim();
    if (mode === "goal" && !goal) {
      setError("Enter a treatment goal before saving.");
      return;
    }
    if (mode === "plan" && !createdPlanId && (!providerId || !planText.trim())) {
      setError("A responsible provider and treatment plan are required.");
      return;
    }
    setSaving(true);
    setError(null);
    let planId = mode === "goal" ? existingPlanId : createdPlanId ?? undefined;
    let goalAlreadySaved = Boolean(savedGoalId);
    try {
      if (!planId && mode === "plan") {
        const draft: TreatmentPlanDraft = {
          providerId, status: "draft", effectiveDate, reviewDueDate,
          problemStatement: problem, planText, interventions,
        };
        const created = await createTreatmentPlan(patientId, draft);
        planId = String(created.id);
        setCreatedPlanId(planId);
        await onPlanPersisted(planId);
      }
      if (!planId) throw new Error("No treatment plan is selected.");
      if (goal && !goalAlreadySaved) {
        const createdGoal = await addTreatmentGoal(planId, { goalText: goal, objectiveText, status: "active" });
        setSavedGoalId(String(createdGoal.id));
        goalAlreadySaved = true;
      }
      await onSaved(planId, goal || undefined);
    } catch (err) {
      // If goal creation fails after the plan was saved, retry against the
      // saved plan ID; never create a second plan on the next submit.
      const reason = err instanceof Error ? err.message : "Unable to finish saving the treatment plan.";
      setError(goalAlreadySaved
        ? `The goal was saved, but the chart could not refresh: ${reason} Retry to finish without adding another goal.`
        : createdPlanId || (mode === "plan" && planId)
          ? `The plan was saved. ${reason} Retry without creating a duplicate plan.`
          : reason);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="encounter-plan-composer" onSubmit={(event) => { void save(event); }} aria-label={mode === "plan" ? "Create patient treatment plan" : "Add goal to treatment plan"}>
      <div className="encounter-plan-composer-heading">
        <div><span className="thera-eyebrow">{mode === "plan" ? "NEW DRAFT" : "EXISTING PLAN"}</span>
          <strong>{mode === "plan" ? "Create Treatment Plan" : "Add Goal / Objective"}</strong></div>
        <button type="button" onClick={onCancel} disabled={saving} aria-label="Close treatment plan form">×</button>
      </div>
      {mode === "plan" && <>
        {createdPlanId ? <div className="thera-alert">Plan saved. Complete its goal or close this form.</div> : <>
          <label>Responsible provider
            <select className="thera-input" required value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              <option value="">Choose provider</option>
              {providerId && !providers.some((p) => p.id === providerId) && <option value={providerId}>Encounter provider</option>}
              {providers.map((p) => <option value={p.id} key={p.id}>
                {[p.first_name, p.last_name].filter(Boolean).join(" ") || "Provider"}{p.credentials ? ", " + String(p.credentials) : ""}
              </option>)}
            </select>
          </label>
          <label>Problem / treatment focus<textarea className="thera-input" rows={2} value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="Document the patient-specific treatment focus" /></label>
          <label>Treatment plan<textarea className="thera-input" required rows={3} value={planText} onChange={(e) => setPlanText(e.target.value)} placeholder="Document the clinical treatment approach" /></label>
          <label>Planned interventions<textarea className="thera-input" rows={2} value={interventions} onChange={(e) => setInterventions(e.target.value)} /></label>
          <div className="encounter-plan-dates">
            <label>Effective date<input className="thera-input" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} /></label>
            <label>Review due<input className="thera-input" type="date" min={effectiveDate || undefined} value={reviewDueDate} onChange={(e) => setReviewDueDate(e.target.value)} /></label>
          </div>
        </>}
        <p className="encounter-plan-form-hint">Saved as a draft; the provider can review and activate it in the patient chart. Creating a plan never blocks clinical signing.</p>
      </>}
      <div className="encounter-plan-goal-fields">
        <label>Measurable goal {mode === "plan" && <span>(optional)</span>}
          <textarea className="thera-input" required={mode === "goal"} disabled={Boolean(savedGoalId)} rows={2} value={goalText} onChange={(e) => setGoalText(e.target.value)} placeholder="Describe the goal in measurable terms" />
        </label>
        <label>Objective <span>(optional)</span>
          <textarea className="thera-input" disabled={Boolean(savedGoalId)} rows={2} value={objectiveText} onChange={(e) => setObjectiveText(e.target.value)} placeholder="Patient-specific objective" />
        </label>
      </div>
      {error && <div className="thera-state error" role="alert">{error}</div>}
      <div className="encounter-plan-composer-footer">
        <button type="button" className="thera-action secondary" disabled={saving} onClick={onCancel}>Cancel</button>
        <button type="submit" className="thera-action" disabled={saving || (mode === "plan" && !createdPlanId && (!providerId || !planText.trim())) || (mode === "goal" && !goalText.trim())}>
          {saving ? "Saving…" : savedGoalId ? "Finish Saved Goal" : createdPlanId ? "Finish Plan" : mode === "plan" ? "Save Draft Plan" : "Add Goal"}
        </button>
      </div>
    </form>
  );
}
