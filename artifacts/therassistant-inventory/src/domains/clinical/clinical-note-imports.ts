type Row = Record<string, unknown>;

/** Keep item order and unanswered responses; never infer clinical risk from answers. */
export function readableSafetyNarrative(input: unknown): string {
  return String(input ?? "").replace(/Answers:\s*(\[[^\]]*\])/, (_, json) => {
    try {
      const answers: unknown = JSON.parse(json);
      if (!Array.isArray(answers)) return "Responses unavailable; review original screening.";
      return answers.map((answer, i) => `Item ${i + 1}: ${answer === true || answer === "yes" ? "Yes" : answer === false || answer === "no" ? "No" : answer == null || answer === "" ? "Not answered" : String(answer)}`).join("; ");
    } catch { return "Responses could not be displayed; review original screening."; }
  });
}

function sortedByDate(rows: Row[]) {
  return [...rows].sort((a, b) => Number(Boolean(b.screening_context_current)) - Number(Boolean(a.screening_context_current)) || String(b.assessed_on ?? b.created_at ?? "").localeCompare(String(a.assessed_on ?? a.created_at ?? "")));
}

function latestTwo(rows: Row[], instrument: string) {
  return sortedByDate(rows.filter((row) => String(row.instrument ?? "") === instrument && row.score !== null && row.score !== undefined && row.score !== "" && Number.isFinite(Number(row.score)))).slice(0, 2);
}

function trend(current: number, prior?: number) {
  if (prior === undefined || Number.isNaN(prior)) return { status: "recorded", direction: "from no prior score" };
  if (current > prior) return { status: "increased", direction: `up from ${prior}` };
  if (current < prior) return { status: "decreased", direction: `down from ${prior}` };
  return { status: "maintained", direction: `unchanged from ${prior}` };
}

export function phqImportNarrative(outcomeMeasures: Row[]) {
  const [current, prior] = latestTwo(outcomeMeasures, "PHQ-9");
  if (!current) return "";
  const score = Number(current.score);
  const priorScore = prior ? Number(prior.score) : undefined;
  const movement = trend(score, priorScore);
  return `PHQ-9: Depression has ${movement.status} since last visit, scoring ${score} on ${String(current.assessed_on ?? "date not recorded")}, ${movement.direction}.`;
}

export function gadImportNarrative(outcomeMeasures: Row[]) {
  const [current, prior] = latestTwo(outcomeMeasures, "GAD-7");
  if (!current) return "";
  const score = Number(current.score);
  const priorScore = prior ? Number(prior.score) : undefined;
  const movement = trend(score, priorScore);
  return `GAD-7: Anxiety has ${movement.status} since last visit, scoring ${score} on ${String(current.assessed_on ?? "date not recorded")}, ${movement.direction}.`;
}

export function cssrsImportNarrative(safetyScreenings: Row[]) {
  const current = sortedByDate(safetyScreenings.filter((row) => String(row.instrument ?? "") === "C-SSRS"))[0];
  if (!current) return "";
  if (current.source === "patient_reported" && !current.risk_level) {
    return `C-SSRS: Patient completed C-SSRS Recent self-report on ${String(current.assessed_on ?? "date not recorded")}. Clinician safety review is required; no clinician risk classification or completed intervention is recorded. ${readableSafetyNarrative(current.narrative)}`;
  }
  const score = String(current.score_text ?? "not recorded");
  const risk = String(current.risk_level ?? "not recorded").replaceAll("_", " ");
  const narrative = readableSafetyNarrative(current.narrative).trim();
  return `C-SSRS: Client scored ${score} on C-SSRS, indicating ${risk} risk.${narrative ? ` ${narrative}` : ""}`;
}

export function screeningContext(rows: Row[], appointmentId: string, serviceDate: string, startedAt: string): Row[] {
  return rows.filter(row => String(row.source_reference_id ?? "") === appointmentId && Boolean(appointmentId)
    || String(row.assessed_on ?? "") < serviceDate && String(row.created_at ?? "") <= startedAt
    || !row.source_reference_id && String(row.assessed_on ?? "") === serviceDate && String(row.created_at ?? "") <= startedAt)
    .map(row => ({...row,screening_context_current:Boolean(appointmentId) && row.source_reference_id===appointmentId}));
}
