import {
  normalizeClinicalTags,
  normalizeDocumentationTemplate,
  type ClinicalTagId,
  type DocumentationTemplate,
} from "./clinical-context";
import type { Row } from "../../lib/tenant-data-client";
import {
  emptyForensicContext,
  normalizeForensicContext,
  type ForensicContext,
} from "./forensic-context";
import {
  emptyPsychedelicContext,
  normalizePsychedelicContext,
  type PsychedelicContext,
} from "./psychedelic-context";

export type SmartPhraseScope = "built_in" | "user" | "practice";
export type SmartPhrase = {
  id: string;
  shortcut: string;
  label: string;
  content: string;
  category?: string | null;
  scope: SmartPhraseScope;
};

export type Severity = "" | "none" | "mild" | "moderate" | "severe";
export type PatientResponse = "" | "engaged" | "receptive" | "mixed" | "limited";
export type RiskSelection = "" | "denies_si_hi" | "passive_si_no_plan" | "safety_plan_reviewed";

export type TimelineEvent = {
  time: string;
  label: string;
  detail: string;
};

export type StructuredSelections = {
  templateType: DocumentationTemplate;
  clinicalTags: ClinicalTagId[];
  forensicContext: ForensicContext;
  psychedelicContext: PsychedelicContext;
  timelineEvents: TimelineEvent[];
  similarityReviewAcknowledged: boolean;
  psychotherapyMinutes: number | null;
  anxiety: Severity;
  depression: Severity;
  interventions: string[];
  response: PatientResponse;
  risk: RiskSelection;
};

export type PriorStructuredContext = {
  noteId: string;
  serviceDate: string | null;
  goalAddressed: string;
  noteText: string;
  selections: StructuredSelections;
};

export const DEFAULT_SMART_PHRASES: SmartPhrase[] = [
  {
    id: "builtin-risk-negative",
    shortcut: ".riskneg",
    label: "Risk: Standard Negative",
    category: "risk",
    scope: "built_in",
    content: "Risk Assessment: Client denies suicidal or homicidal ideation. No acute safety concerns reported.",
  },
  {
    id: "builtin-mse-wnl",
    shortcut: ".msewnl",
    label: "MSE: Within Normal Limits",
    category: "mse",
    scope: "built_in",
    content: "Mental Status: Alert and oriented x4. Appearance and behavior appropriate. Speech normal. Thought process linear and goal directed.",
  },
  {
    id: "builtin-supportive",
    shortcut: ".supportive",
    label: "Intervention: Supportive",
    category: "intervention",
    scope: "built_in",
    content: "Intervention: Supportive psychotherapy, reflective listening, validation, and collaborative problem solving were utilized.",
  },
  {
    id: "builtin-gad7",
    shortcut: ".gad7",
    label: "GAD-7 Documentation",
    category: "outcome",
    scope: "built_in",
    content: "GAD-7: Score ___/21. Severity: ___. Functional impact: ___.",
  },
];

export function emptyStructuredSelections(): StructuredSelections {
  return {
    templateType: "standard_therapy",
    clinicalTags: [],
    forensicContext: emptyForensicContext(),
    psychedelicContext: emptyPsychedelicContext(),
    timelineEvents: [],
    similarityReviewAcknowledged: false,
    psychotherapyMinutes: null,
    anxiety: "",
    depression: "",
    interventions: [],
    response: "",
    risk: "",
  };
}

export function normalizeStructuredSelections(value: unknown): StructuredSelections {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
  const validSeverity = new Set(["", "none", "mild", "moderate", "severe"]);
  const validResponse = new Set(["", "engaged", "receptive", "mixed", "limited"]);
  const validRisk = new Set(["", "denies_si_hi", "passive_si_no_plan", "safety_plan_reviewed"]);
  const anxiety = String(source.anxiety ?? "");
  const depression = String(source.depression ?? "");
  const response = String(source.response ?? "");
  const risk = String(source.risk ?? "");
  const rawTimeline = source.timelineEvents ?? source.timeline_events;
  const timelineEvents = Array.isArray(rawTimeline)
    ? rawTimeline.slice(0, 50).flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const row = item as Row;
        const time = String(row.time ?? "").trim();
        const label = String(row.label ?? "").trim();
        const detail = String(row.detail ?? "").trim();
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !label) return [];
        return [{ time, label: label.slice(0, 120), detail: detail.slice(0, 500) }];
      })
    : [];

  return {
    templateType: normalizeDocumentationTemplate(source.templateType ?? source.template_type),
    clinicalTags: normalizeClinicalTags(source.clinicalTags ?? source.clinical_tags),
    forensicContext: normalizeForensicContext(source.forensicContext ?? source.forensic_context),
    psychedelicContext: normalizePsychedelicContext(source.psychedelicContext ?? source.psychedelic_context),
    timelineEvents,
    similarityReviewAcknowledged: source.similarityReviewAcknowledged === true || source.similarity_review_acknowledged === true,
    psychotherapyMinutes: typeof source.psychotherapyMinutes === "number" && Number.isInteger(source.psychotherapyMinutes) && source.psychotherapyMinutes > 0 && source.psychotherapyMinutes <= 1440 ? source.psychotherapyMinutes : null,
    anxiety: validSeverity.has(anxiety) ? anxiety as Severity : "",
    depression: validSeverity.has(depression) ? depression as Severity : "",
    interventions: Array.isArray(source.interventions) ? source.interventions.map(String) : [],
    response: validResponse.has(response) ? response as PatientResponse : "",
    risk: validRisk.has(risk) ? risk as RiskSelection : "",
  };
}

export function normalizeSmartPhraseShortcut(value: string) {
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
  if (!cleaned) return "";
  return cleaned.startsWith(".") ? cleaned : "." + cleaned;
}

export function expandSmartPhraseAtCursor(value: string, cursor: number, phrases: SmartPhrase[]) {
  const before = value.slice(0, cursor);
  const match = before.match(/(^|\s)(\.[A-Za-z0-9_-]+)\s$/);
  if (!match) return null;
  const shortcut = match[2].toLowerCase();
  const phrase = phrases.find((item) => item.shortcut.toLowerCase() === shortcut);
  if (!phrase) return null;
  const tokenStart = cursor - match[2].length - 1;
  const next = value.slice(0, tokenStart) + phrase.content + " " + value.slice(cursor);
  return { value: next, cursor: tokenStart + phrase.content.length + 1, phrase };
}

const interventionLabels: Record<string, string> = {
  cognitive_reframing: "cognitive reframing",
  supportive: "supportive psychotherapy",
  motivational_interviewing: "motivational interviewing",
  grounding: "grounding techniques",
  psychoeducation: "psychoeducation",
};

export function synthesizeStructuredNarrative(selections: StructuredSelections) {
  const parts: string[] = [];
  const symptoms: string[] = [];
  if (selections.anxiety) symptoms.push("anxiety: " + selections.anxiety);
  if (selections.depression) symptoms.push("depressive symptoms: " + selections.depression);
  if (symptoms.length) parts.push("Clinical presentation included " + symptoms.join("; ") + ".");

  const interventions = selections.interventions.map((item) => interventionLabels[item] ?? item.replaceAll("_", " "));
  if (interventions.length) parts.push("Interventions included " + interventions.join(", ") + ".");

  const responseLabels: Record<string, string> = {
    engaged: "Patient was engaged throughout the intervention.",
    receptive: "Patient was receptive to the interventions used.",
    mixed: "Patient demonstrated a mixed response to interventions.",
    limited: "Patient demonstrated limited response to interventions during this session.",
  };
  if (selections.response) parts.push(responseLabels[selections.response]);

  const riskLabels: Record<string, string> = {
    denies_si_hi: "Risk assessment: Client denied suicidal and homicidal ideation; no acute safety concern was selected in the structured assessment.",
    passive_si_no_plan: "Risk assessment: Passive suicidal ideation without plan or intent was selected for further provider assessment and documentation.",
    safety_plan_reviewed: "Safety planning was reviewed during the session.",
  };
  if (selections.risk) parts.push(riskLabels[selections.risk]);
  return parts.join(" ");
}

export const NOTE_SIMILARITY_REVIEW_THRESHOLD = 0.85;

function noteTokens(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function shingles(tokens: string[], size: number) {
  const result = new Set<string>();
  for (let index = 0; index <= tokens.length - size; index += 1) {
    result.add(tokens.slice(index, index + size).join(" "));
  }
  return result;
}

export function clinicalNoteSimilarity(current: string, prior: string) {
  const currentTokens = noteTokens(current);
  const priorTokens = noteTokens(prior);
  if (currentTokens.length < 30 || priorTokens.length < 30) return 0;

  const currentShingles = shingles(currentTokens, 5);
  const priorShingles = shingles(priorTokens, 5);
  if (!currentShingles.size || !priorShingles.size) return 0;

  let overlap = 0;
  for (const item of currentShingles) {
    if (priorShingles.has(item)) overlap += 1;
  }
  return (2 * overlap) / (currentShingles.size + priorShingles.size);
}

export function formatTimelineForNote(events: TimelineEvent[]) {
  if (!events.length) return "";
  return [
    "SESSION TIMELINE",
    ...events.map((event) =>
      `[${event.time}] ${event.label}${event.detail ? ` — ${event.detail}` : ""}`
    ),
  ].join("\n");
}
