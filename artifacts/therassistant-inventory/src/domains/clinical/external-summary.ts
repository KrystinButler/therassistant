import { CLINICAL_TAG_OPTIONS } from "./clinical-context";
import { formatTimelineForNote, type StructuredSelections } from "./fast-charting";
import { formatForensicContextForExternalSummary } from "./forensic-context";

export type ExternalSummaryAudience = "court_supervision" | "authorized_external";

export type ExternalSummaryOptions = {
  audience: ExternalSummaryAudience;
  includeTreatmentFocus: boolean;
  includeParticipation: boolean;
  includeInterventions: boolean;
  includeDiagnoses: boolean;
  includeRisk: boolean;
  includeClinicalTags: boolean;
  includeTimeline: boolean;
  includeForensicProgress: boolean;
};

export type ExternalSummaryDiagnosis = {
  code: string;
  description?: string | null;
};

export type ExternalSummaryInput = {
  patientName: string;
  providerName: string;
  serviceDate: string;
  serviceType: string;
  attendanceStatus: string;
  goalAddressed: string;
  selections: StructuredSelections;
  diagnoses: ExternalSummaryDiagnosis[];
};

export const DEFAULT_EXTERNAL_SUMMARY_OPTIONS: ExternalSummaryOptions = {
  audience: "court_supervision",
  includeTreatmentFocus: true,
  includeParticipation: true,
  includeInterventions: true,
  includeDiagnoses: false,
  includeRisk: false,
  includeClinicalTags: false,
  includeTimeline: false,
  includeForensicProgress: false,
};

const interventionLabels: Record<string, string> = {
  cognitive_reframing: "Cognitive reframing",
  supportive: "Supportive psychotherapy",
  motivational_interviewing: "Motivational interviewing",
  grounding: "Grounding techniques",
  psychoeducation: "Psychoeducation",
};

const responseLabels: Record<string, string> = {
  engaged: "Engaged",
  receptive: "Receptive",
  mixed: "Mixed response",
  limited: "Limited response",
};

const riskLabels: Record<string, string> = {
  denies_si_hi: "Client denied suicidal and homicidal ideation; no acute safety concern was selected in the structured assessment.",
  passive_si_no_plan: "Passive suicidal ideation without plan or intent was selected for provider assessment.",
  safety_plan_reviewed: "Safety planning was reviewed.",
};

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function buildExternalTreatmentSummary(
  input: ExternalSummaryInput,
  options: ExternalSummaryOptions,
) {
  const audience =
    options.audience === "court_supervision"
      ? "Court / Probation / Parole"
      : "Authorized External Party";

  const lines = [
    "EXTERNAL TREATMENT SUMMARY",
    `Audience: ${audience}`,
    "",
    `Patient: ${input.patientName || "—"}`,
    `Provider: ${input.providerName || "—"}`,
    `Service date: ${input.serviceDate || "—"}`,
    `Service: ${input.serviceType || "—"}`,
    `Attendance / visit status: ${humanize(input.attendanceStatus || "unknown")}`,
  ];

  if (options.includeTreatmentFocus && input.goalAddressed.trim()) {
    lines.push("", "Treatment focus", input.goalAddressed.trim());
  }

  if (options.includeParticipation) {
    const response = responseLabels[input.selections.response];
    if (response) lines.push("", "Participation / response", response);
  }

  if (options.includeInterventions && input.selections.interventions.length) {
    lines.push(
      "",
      "Interventions",
      input.selections.interventions
        .map((item) => interventionLabels[item] ?? humanize(item))
        .join("; "),
    );
  }

  if (options.includeDiagnoses && input.diagnoses.length) {
    lines.push(
      "",
      "Diagnoses",
      ...input.diagnoses.map((diagnosis) =>
        `${diagnosis.code}${diagnosis.description ? ` — ${diagnosis.description}` : ""}`
      ),
    );
  }

  if (options.includeRisk && input.selections.risk) {
    lines.push("", "Risk / safety", riskLabels[input.selections.risk] ?? humanize(input.selections.risk));
  }

  if (options.includeClinicalTags && input.selections.clinicalTags.length) {
    const labels = new Map(CLINICAL_TAG_OPTIONS.map((tag) => [tag.id, tag.label]));
    lines.push(
      "",
      "Clinician-selected chart context",
      input.selections.clinicalTags.map((tag) => labels.get(tag) ?? humanize(tag)).join("; "),
    );
  }

  if (options.includeTimeline && input.selections.timelineEvents.length) {
    lines.push("", formatTimelineForNote(input.selections.timelineEvents));
  }

  if (options.includeForensicProgress) {
    const forensic = formatForensicContextForExternalSummary(input.selections.forensicContext);
    if (forensic) lines.push("", forensic);
  }

  lines.push(
    "",
    "Disclosure note",
    "Generated from the signed clinical record. This is not a replacement clinical note. Verify authorization and minimum-necessary disclosure before release.",
  );

  return lines.join("\n");
}
