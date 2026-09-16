export type PreVisitResponses = {
  focusToday?: string;
  moodSinceLastVisit?: string;
  recentChanges?: string;
  safetyConcerns?: string;
  goalFocus?: string;
  providerMessage?: string;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizePreVisitResponses(value: unknown): PreVisitResponses {
  if (!value || typeof value !== "object") return {};
  const row = value as Record<string, unknown>;
  return {
    focusToday: text(row.focus_today),
    moodSinceLastVisit: text(row.mood_since_last_visit),
    recentChanges: text(row.recent_changes),
    safetyConcerns: text(row.safety_concerns),
    goalFocus: text(row.goal_focus),
    providerMessage: text(row.provider_message),
  };
}
