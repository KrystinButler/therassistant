type Row = Record<string, unknown>;
function record(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => [key,canonical(item)]));
  return value;
}
export function portalSectionMatchesSaved(current: unknown, saved: unknown, savedAt: string) {
  return Boolean(savedAt) && JSON.stringify(canonical(current)) === JSON.stringify(canonical(saved));
}
export function getPreVisitSummary(checkin: Row | undefined) {
  const preVisit = record(record(checkin?.responses).pre_visit);
  const submitted = Boolean(preVisit.submitted_at);
  const consents = record(preVisit.consents);
  const steps = [preVisit.demographics_confirmed === true, preVisit.insurance_confirmed === true,
    Boolean(preVisit.visit_questions_saved_at), Boolean(preVisit.consents_saved_at) &&
      ["information_accurate","privacy_acknowledged","care_acknowledged"].every(key => consents[key] === true), submitted];
  const started = Object.keys(preVisit).length > 0;
  return {
    label: submitted ? "Submitted to care team" : started ? "Saved draft · not submitted" : "Not started",
    action: submitted ? "Review Check-In" : started ? "Continue Check-In" : "Complete Check-In",
    submitted, completeSteps: submitted ? 5 : steps.filter(Boolean).length,
  };
}
export function getJournalDisplayState(entry: Row) {
  const draft = String(entry.entry_status ?? "submitted") === "draft";
  const sharedWithProvider = !draft && entry.visibility === "shared_with_provider";
  return { label: draft ? "Draft · not shared" : sharedWithProvider ? "Shared with provider" : "Saved privately",
    tone: draft ? "draft" : sharedWithProvider ? "shared" : "private", sharedWithProvider };
}
