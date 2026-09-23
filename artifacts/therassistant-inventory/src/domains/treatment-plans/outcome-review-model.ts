export type Instrument = "PHQ-9" | "GAD-7";
export type Measure = { id: string; instrument: Instrument; score: number; assessed_on: string; source?: string; };
export type Goal = { goal_text?: unknown; objective_text?: unknown; status?: unknown; };
export type Visit = { service_date?: unknown; note_status?: unknown; };
export type Plan = {
  id: string; effective_date?: unknown; review_due_date?: unknown;
  problem_statement?: unknown; interventions?: unknown; provider_id?: unknown;
  goals?: Goal[];
};
export function maxScore(instrument: Instrument) { return instrument === "PHQ-9" ? 27 : 21; }
export function validateScore(instrument: Instrument, score: number) {
  return Number.isInteger(score) && score >= 0 && score <= maxScore(instrument);
}
export function outcomeTrend(measures: Measure[], instrument: Instrument) {
  const list = measures.filter(m => m.instrument === instrument)
    .sort((a,b) => a.assessed_on.localeCompare(b.assessed_on) || a.id.localeCompare(b.id));
  if (!list.length) return null;
  const first = list[0], last = list[list.length - 1];
  return { first, last, delta: last.score - first.score, count: list.length };
}
export function buildReviewDraft(args: { plan: Plan; measures: Measure[]; visits: Visit[]; reviewDate: string }) {
  const { plan, measures, visits, reviewDate } = args;
  const activeGoals = (plan.goals ?? []).filter(g => !["discontinued","achieved"].includes(String(g.status ?? "active")));
  const signedVisits = visits.filter(v => ["signed","locked"].includes(String(v.note_status ?? "")) && String(v.service_date ?? "") <= reviewDate)
    .sort((a,b) => String(a.service_date ?? "").localeCompare(String(b.service_date ?? "")));
  const start = String(plan.effective_date || "");
  const inPeriod = start ? signedVisits.filter(v => String(v.service_date ?? "") >= start) : signedVisits;
  const evidence: Record<string,unknown> = {
    source_plan_id: plan.id, review_date: reviewDate,
    goal_count: activeGoals.length,
    signed_visit_count: inPeriod.length,
    signed_visit_first: inPeriod[0]?.service_date ?? null,
    signed_visit_last: inPeriod[inPeriod.length-1]?.service_date ?? null,
    outcome_trends: {} as Record<string,unknown>,
  };
  const sections = [
    "90-DAY TREATMENT PLAN REVIEW — DRAFT FOR CLINICIAN EDITING",
    "Review date: " + reviewDate,
    "Current problem: " + String(plan.problem_statement || "Requires clinician documentation."),
    "Goals and objectives:",
    activeGoals.length
      ? activeGoals.map((goal, i) => String(i+1) + ". " + String(goal.goal_text || "Goal needs review") +
          (goal.objective_text ? " | Objective: " + String(goal.objective_text) : "") +
          " | Status: " + String(goal.status || "active") + " [CLINICIAN: assess progress]").join("\n")
      : "No active goals were found. Clinician must add or reconcile goals.",
    "Clinical course:",
    inPeriod.length
      ? String(inPeriod.length) + " signed visit(s) in the review period, from " +
        String(inPeriod[0].service_date) + " to " + String(inPeriod[inPeriod.length-1].service_date) + "."
      : "No signed visits in this review period were found in the record.",
    "Outcome measures:",
  ];
  for (const instrument of ["PHQ-9","GAD-7"] as Instrument[]) {
    const series = measures.filter(m => m.assessed_on <= reviewDate && (!start || m.assessed_on >= start));
    const trend = outcomeTrend(series, instrument);
    (evidence.outcome_trends as Record<string,unknown>)[instrument] = trend
      ? { first_id:trend.first.id,last_id:trend.last.id,first_score:trend.first.score,last_score:trend.last.score,delta:trend.delta }
      : null;
    sections.push(trend
      ? instrument + ": " + trend.first.score + " (" + trend.first.assessed_on + ") → " + trend.last.score +
        " (" + trend.last.assessed_on + "); change " + (trend.delta > 0 ? "+" : "") + trend.delta +
        ". [CLINICIAN: interpret alongside patient presentation.]"
      : instrument + ": No score recorded in this review period.");
  }
  sections.push("Current interventions: " + String(plan.interventions || "Not entered."));
  sections.push("Clinical assessment of progress: [CLINICIAN TO COMPLETE]");
  sections.push("Revised goals, objectives and interventions: [CLINICIAN TO COMPLETE]");
  sections.push("Plan / next review: [CLINICIAN TO COMPLETE]");
  sections.push("This is an editable draft. The existing active plan is unchanged; separate clinician review and signature are required.");
  return { draftText: sections.join("\n\n"), evidence };
}
