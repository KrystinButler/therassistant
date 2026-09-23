import {
  normalizeClinicalTags,
  normalizeDocumentationTemplate,
  type ClinicalTagId,
  type DocumentationTemplate,
} from "./clinical-context";
import type { Row } from "../../lib/tenant-data-client";

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

export type StructuredSelections = {
  templateType: DocumentationTemplate;
  clinicalTags: ClinicalTagId[];
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
  return {
    templateType: normalizeDocumentationTemplate(source.templateType ?? source.template_type),
    clinicalTags: normalizeClinicalTags(source.clinicalTags ?? source.clinical_tags),
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
