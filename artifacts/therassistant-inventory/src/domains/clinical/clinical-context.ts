export type DocumentationTemplate =
  | "standard_therapy"
  | "intake"
  | "forensic"
  | "pat_preparation"
  | "kap_medicine_session"
  | "pat_integration"
  | "extended_session"
  | "integration";

export type ClinicalTagId =
  | "anxiety"
  | "depressive_symptoms"
  | "trauma_related"
  | "substance_use"
  | "psychosis_symptoms"
  | "sleep_disturbance"
  | "safety_concern"
  | "legal_forensic_context"
  | "medication_effect"
  | "altered_state_phenomenon";

export const DOCUMENTATION_TEMPLATES: Array<{
  id: DocumentationTemplate;
  label: string;
  description: string;
  prompts: string[];
}> = [
  {
    id: "standard_therapy",
    label: "Standard Therapy",
    description: "Routine psychotherapy documentation tied to the treatment plan.",
    prompts: ["Focus", "Intervention", "Patient response", "Progress / plan"],
  },
  {
    id: "intake",
    label: "Intake / Assessment",
    description: "Presenting concerns, history, assessment, safety, and initial plan.",
    prompts: ["Presenting concern", "Relevant history", "Assessment", "Risk / safety", "Initial plan"],
  },
  {
    id: "forensic",
    label: "Forensic / Justice-Involved",
    description: "Optional forensic treatment context without changing the core clinical record.",
    prompts: ["Treatment focus", "Behavior / accountability", "Response", "Risk / protective context", "Plan"],
  },
  {
    id: "pat_preparation",
    label: "PAT/KAP Preparation",
    description: "Preparation and readiness documentation before a medicine-assisted or psychedelic-assisted session.",
    prompts: ["Readiness / screening", "Intention", "Support plan", "Safety / logistics", "Plan"],
  },
  {
    id: "kap_medicine_session",
    label: "KAP Medicine Session",
    description: "Extended medicine-assisted session documentation using provider-entered observations and the session timeline.",
    prompts: ["Medicine / administration context", "Monitoring / observations", "Altered-state phenomena", "Grounding / recovery", "Plan"],
  },
  {
    id: "pat_integration",
    label: "PAT/KAP Integration",
    description: "Post-experience integration documentation that connects themes back to function, treatment goals, and plan.",
    prompts: ["Experience reviewed", "Meaning / themes", "Functional impact", "Integration intervention", "Plan"],
  },
  {
    id: "extended_session",
    label: "Extended Session",
    description: "Longer encounters where phase and timeline context may matter.",
    prompts: ["Session phase", "Key events", "Interventions", "Response", "Safety", "Plan"],
  },
  {
    id: "integration",
    label: "Integration",
    description: "Post-experience integration documentation using the same signed-note workflow.",
    prompts: ["Experience reviewed", "Meaning / themes", "Functional impact", "Integration intervention", "Plan"],
  },
];

export const CLINICAL_TAG_OPTIONS: Array<{
  id: ClinicalTagId;
  label: string;
  kind: "symptom" | "context";
}> = [
  { id: "anxiety", label: "Anxiety", kind: "symptom" },
  { id: "depressive_symptoms", label: "Depressive symptoms", kind: "symptom" },
  { id: "trauma_related", label: "Trauma-related", kind: "symptom" },
  { id: "substance_use", label: "Substance use", kind: "symptom" },
  { id: "psychosis_symptoms", label: "Psychosis symptoms", kind: "symptom" },
  { id: "sleep_disturbance", label: "Sleep disturbance", kind: "symptom" },
  { id: "safety_concern", label: "Safety concern", kind: "context" },
  { id: "legal_forensic_context", label: "Legal / forensic context", kind: "context" },
  { id: "medication_effect", label: "Medication effect", kind: "context" },
  { id: "altered_state_phenomenon", label: "Altered-state phenomenon", kind: "context" },
];

const validTemplates = new Set(DOCUMENTATION_TEMPLATES.map((item) => item.id));
const validTags = new Set(CLINICAL_TAG_OPTIONS.map((item) => item.id));

export function normalizeDocumentationTemplate(value: unknown): DocumentationTemplate {
  const candidate = String(value ?? "");
  return validTemplates.has(candidate as DocumentationTemplate)
    ? candidate as DocumentationTemplate
    : "standard_therapy";
}

export function normalizeClinicalTags(value: unknown): ClinicalTagId[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map(String)
      .filter((item): item is ClinicalTagId => validTags.has(item as ClinicalTagId)),
  )];
}

export function documentationTemplateById(id: DocumentationTemplate) {
  return DOCUMENTATION_TEMPLATES.find((item) => item.id === id) ?? DOCUMENTATION_TEMPLATES[0];
}
