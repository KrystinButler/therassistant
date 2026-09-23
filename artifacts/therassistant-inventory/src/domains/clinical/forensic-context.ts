import type { Row } from "../../lib/tenant-data-client";

export type ForensicFramework =
  | "none"
  | "justice_involved"
  | "dvomb_adult"
  | "somb_adult"
  | "other_specialty";

export type ForensicProgressRating =
  | ""
  | "improving"
  | "stable"
  | "needs_attention"
  | "not_assessed";

export type ForensicAssessmentReference = {
  name: string;
  date: string;
  resultSummary: string;
};

export type ForensicContext = {
  framework: ForensicFramework;
  referralSource: string;
  coordinationContext: string;
  standardsReviewedOn: string;
  assessmentReferences: ForensicAssessmentReference[];
  progress: {
    attendance: ForensicProgressRating;
    engagement: ForensicProgressRating;
    accountability: ForensicProgressRating;
    responsivity: ForensicProgressRating;
    skillApplication: ForensicProgressRating;
  };
  dynamicTreatmentNeeds: string;
  protectiveFactors: string;
  providerNarrative: string;
};

export const FORENSIC_REFERENCE_LINKS = {
  dvomb_adult: {
    label: "Colorado DVOMB Standards / revisions",
    url: "https://dcj.colorado.gov/dvomb-standards-revisions",
  },
  somb_adult: {
    label: "Colorado SOMB Adult Standards / bulletins",
    url: "https://dcj.colorado.gov/dcj-offices/odvsom/somb-standards-bulletins",
  },
} as const;

const frameworks = new Set<ForensicFramework>([
  "none",
  "justice_involved",
  "dvomb_adult",
  "somb_adult",
  "other_specialty",
]);

const ratings = new Set<ForensicProgressRating>([
  "",
  "improving",
  "stable",
  "needs_attention",
  "not_assessed",
]);

export function emptyForensicContext(): ForensicContext {
  return {
    framework: "none",
    referralSource: "",
    coordinationContext: "",
    standardsReviewedOn: "",
    assessmentReferences: [],
    progress: {
      attendance: "",
      engagement: "",
      accountability: "",
      responsivity: "",
      skillApplication: "",
    },
    dynamicTreatmentNeeds: "",
    protectiveFactors: "",
    providerNarrative: "",
  };
}

function text(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function rating(value: unknown): ForensicProgressRating {
  const candidate = String(value ?? "") as ForensicProgressRating;
  return ratings.has(candidate) ? candidate : "";
}

export function normalizeForensicContext(value: unknown): ForensicContext {
  const source =
    value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
  const rawFramework = String(source.framework ?? "") as ForensicFramework;
  const progress =
    source.progress && typeof source.progress === "object" && !Array.isArray(source.progress)
      ? source.progress as Row
      : {};
  const rawAssessments = Array.isArray(source.assessmentReferences ?? source.assessment_references)
    ? source.assessmentReferences ?? source.assessment_references
    : [];

  return {
    framework: frameworks.has(rawFramework) ? rawFramework : "none",
    referralSource: text(source.referralSource ?? source.referral_source, 200),
    coordinationContext: text(source.coordinationContext ?? source.coordination_context, 500),
    standardsReviewedOn: /^\d{4}-\d{2}-\d{2}$/.test(String(source.standardsReviewedOn ?? source.standards_reviewed_on ?? ""))
      ? String(source.standardsReviewedOn ?? source.standards_reviewed_on)
      : "",
    assessmentReferences: Array.isArray(rawAssessments)
      ? rawAssessments.slice(0, 20).flatMap((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return [];
          const row = item as Row;
          const name = text(row.name, 120);
          if (!name) return [];
          const date = /^\d{4}-\d{2}-\d{2}$/.test(String(row.date ?? "")) ? String(row.date) : "";
          return [{
            name,
            date,
            resultSummary: text(row.resultSummary ?? row.result_summary, 500),
          }];
        })
      : [],
    progress: {
      attendance: rating(progress.attendance),
      engagement: rating(progress.engagement),
      accountability: rating(progress.accountability),
      responsivity: rating(progress.responsivity),
      skillApplication: rating(progress.skillApplication ?? progress.skill_application),
    },
    dynamicTreatmentNeeds: text(source.dynamicTreatmentNeeds ?? source.dynamic_treatment_needs, 2000),
    protectiveFactors: text(source.protectiveFactors ?? source.protective_factors, 2000),
    providerNarrative: text(source.providerNarrative ?? source.provider_narrative, 3000),
  };
}

export function forensicContextForCarryForward(value: ForensicContext): ForensicContext {
  return {
    ...emptyForensicContext(),
    framework: value.framework,
    referralSource: value.referralSource,
    coordinationContext: value.coordinationContext,
    standardsReviewedOn: value.standardsReviewedOn,
  };
}

const ratingLabels: Record<Exclude<ForensicProgressRating, "">, string> = {
  improving: "Improving",
  stable: "Stable",
  needs_attention: "Needs attention",
  not_assessed: "Not assessed this session",
};

function progressLines(context: ForensicContext) {
  const entries: Array<[string, ForensicProgressRating]> = [
    ["Attendance / participation", context.progress.attendance],
    ["Treatment engagement", context.progress.engagement],
    ["Accountability / responsibility work", context.progress.accountability],
    ["Responsivity / barriers", context.progress.responsivity],
    ["Skill application", context.progress.skillApplication],
  ];
  return entries.flatMap(([label, value]) =>
    value ? [`${label}: ${ratingLabels[value as Exclude<ForensicProgressRating, "">]}`] : []
  );
}

export function formatForensicContextForNote(context: ForensicContext) {
  if (context.framework === "none") return "";
  const lines = [
    "FORENSIC / JUSTICE-INVOLVED TREATMENT CONTEXT",
    `Framework: ${context.framework.replaceAll("_", " ")}`,
  ];
  if (context.referralSource) lines.push(`Referral source: ${context.referralSource}`);
  if (context.coordinationContext) lines.push(`Coordination context: ${context.coordinationContext}`);
  const progress = progressLines(context);
  if (progress.length) lines.push("", "Provider-observed treatment progress", ...progress);
  if (context.dynamicTreatmentNeeds) lines.push("", "Dynamic treatment needs", context.dynamicTreatmentNeeds);
  if (context.protectiveFactors) lines.push("", "Protective factors / strengths", context.protectiveFactors);
  if (context.providerNarrative) lines.push("", "Provider narrative", context.providerNarrative);
  if (context.assessmentReferences.length) {
    lines.push(
      "",
      "Assessment references",
      ...context.assessmentReferences.map((item) =>
        `${item.name}${item.date ? ` (${item.date})` : ""}${item.resultSummary ? `: ${item.resultSummary}` : ""}`
      ),
    );
  }
  lines.push("", "This section records provider-entered observations and assessment references; it does not calculate a risk score or determine standards compliance.");
  return lines.join("\n");
}

export function formatForensicContextForExternalSummary(context: ForensicContext) {
  if (context.framework === "none") return "";
  const lines = ["Forensic / justice-involved treatment progress"];
  const progress = progressLines(context);
  if (progress.length) lines.push(...progress);
  if (context.providerNarrative) lines.push(`Provider summary: ${context.providerNarrative}`);
  return lines.join("\n");
}
