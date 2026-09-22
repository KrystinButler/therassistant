import { useMemo, useState } from "react";

import { StatusBadge } from "../../components/status-badge";
import { shortDate } from "../../lib/format";
import { saveTreatmentPlanReview, signTreatmentPlanReview } from "./repository";

type DataRow = Record<string, unknown> & { id: string };
type Review = DataRow & { goals?: DataRow[] };
type GoalEdit = { decision: string; comments: string };

export function TreatmentPlanReviewCard({
  review,
  onChanged,
}: {
  review: Review;
  onChanged: () => Promise<void>;
}) {
  const signed = String(review.status ?? "") === "signed";
  const goals = Array.isArray(review.goals) ? review.goals : [];
  const [clinicianSummary, setClinicianSummary] = useState(String(review.clinician_summary ?? ""));
  const [goalEdits, setGoalEdits] = useState<Record<string, GoalEdit>>(() => {
    const initial: Record<string, GoalEdit> = {};
    for (const goal of goals) {
      initial[goal.id] = {
        decision: String(goal.clinician_decision ?? "pending"),
        comments: String(goal.clinician_comments ?? ""),
      };
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const pendingCount = useMemo(
    () => Object.values(goalEdits).filter((edit) => edit.decision === "pending").length,
    [goalEdits],
  );

  function editGoal(goalId: string, key: "decision" | "comments", value: string) {
    setGoalEdits((current) => ({
      ...current,
      [goalId]: {
        ...(current[goalId] ?? { decision: "pending", comments: "" }),
        [key]: value,
      },
    }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await saveTreatmentPlanReview(
        review.id,
        clinicianSummary,
        goals.map((goal) => ({
          id: goal.id,
          decision: goalEdits[goal.id]?.decision ?? "pending",
          comments: goalEdits[goal.id]?.comments ?? "",
        })),
      );
      setMessage("Treatment-plan review draft saved.");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save treatment-plan review.");
    } finally {
      setSaving(false);
    }
  }

  async function sign() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await saveTreatmentPlanReview(
        review.id,
        clinicianSummary,
        goals.map((goal) => ({
          id: goal.id,
          decision: goalEdits[goal.id]?.decision ?? "pending",
          comments: goalEdits[goal.id]?.comments ?? "",
        })),
      );
      await signTreatmentPlanReview(review.id);
      setMessage("90-day treatment-plan review signed. The next review due date was advanced 90 days; the treatment plan and goal text were not rewritten.");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign treatment-plan review.");
    } finally {
      setSaving(false);
    }
  }

  return <article className="thera-work-card">
    <div className="thera-work-card-top">
      <div>
        <strong>90-Day Treatment Plan Review</strong>
        <div className="thera-table-subtext">
          {shortDate(String(review.review_period_start ?? ""))} – {shortDate(String(review.review_period_end ?? ""))}
        </div>
      </div>
      <div><StatusBadge value={String(review.status ?? "draft")} /></div>
    </div>

    {error && <div className="thera-state error" style={{ marginTop: 10 }}>{error}</div>}
    {message && <div className="thera-alert" style={{ marginTop: 10 }}>{message}</div>}

    <div style={{ marginTop: 12 }}>
      <div className="thera-field-label">Generated Evidence Summary</div>
      <div>{String(review.generated_summary ?? "—")}</div>
    </div>

    <div style={{ marginTop: 14 }}>
      <label className="thera-field">
        <span className="thera-field-label">Clinician Review Summary</span>
        <textarea
          className="thera-input"
          rows={4}
          disabled={signed}
          value={clinicianSummary}
          onChange={(event) => setClinicianSummary(event.target.value)}
          placeholder="Clinician interpretation of progress, barriers, treatment response, and plan for the next review period"
        />
      </label>
    </div>

    <div style={{ marginTop: 16 }}>
      <div className="thera-row-between">
        <strong>Goal Review</strong>
        {!signed && <span className="thera-table-subtext">{pendingCount} pending clinician decision{pendingCount === 1 ? "" : "s"}</span>}
      </div>
      {goals.length ? <div className="thera-stack" style={{ marginTop: 10 }}>
        {goals.map((goal) => <div className="thera-card" style={{ padding: 12 }} key={goal.id}>
          <strong>{String(goal.goal_text_snapshot ?? "Goal")}</strong>
          {Boolean(goal.objective_text_snapshot) && <div className="thera-table-subtext" style={{ marginTop: 3 }}>Objective: {String(goal.objective_text_snapshot)}</div>}
          <p style={{ marginBottom: 8 }}>{String(goal.progress_summary ?? "")}</p>
          <div className="thera-form-grid">
            <label className="thera-field">
              <span className="thera-field-label">Clinician Decision</span>
              <select
                className="thera-input"
                disabled={signed}
                value={goalEdits[goal.id]?.decision ?? "pending"}
                onChange={(event) => editGoal(goal.id, "decision", event.target.value)}
              >
                <option value="pending">Pending clinician decision</option>
                <option value="continue">Continue</option>
                <option value="met">Goal met</option>
                <option value="revise">Revise</option>
                <option value="discontinue">Discontinue</option>
              </select>
            </label>
            <label className="thera-field">
              <span className="thera-field-label">Clinician Comments</span>
              <input
                className="thera-input"
                disabled={signed}
                value={goalEdits[goal.id]?.comments ?? ""}
                onChange={(event) => editGoal(goal.id, "comments", event.target.value)}
                placeholder="Optional goal-specific interpretation"
              />
            </label>
          </div>
        </div>)}
      </div> : <div className="thera-empty">No goals were attached to the treatment plan when this review was generated.</div>}
    </div>

    {!signed && <div className="thera-filter-row" style={{ marginTop: 14 }}>
      <button type="button" className="thera-action secondary" disabled={saving} onClick={() => void save()}>
        {saving ? "Saving..." : "Save Review Draft"}
      </button>
      <button
        type="button"
        className="thera-action"
        disabled={saving || pendingCount > 0 || !clinicianSummary.trim()}
        onClick={() => void sign()}
      >
        Sign 90-Day Review
      </button>
    </div>}

    {signed && <div className="thera-alert" style={{ marginTop: 14 }}>
      Signed {review.signed_at ? new Date(String(review.signed_at)).toLocaleString() : "review"}. The source treatment-plan text remains unchanged.
    </div>}
  </article>;
}
