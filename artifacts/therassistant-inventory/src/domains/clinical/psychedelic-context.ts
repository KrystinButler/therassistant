import type { Row } from "../../lib/tenant-data-client";
import type { DocumentationTemplate } from "./clinical-context";

export type PsychedelicPhase =
  | "none"
  | "preparation"
  | "medicine_session"
  | "integration";

export type PsychedelicPhenomenon =
  | "altered_sensory_perception"
  | "time_space_change"
  | "sense_of_self_change"
  | "somatic_response"
  | "emotional_release"
  | "dissociation"
  | "grounding_return";

export const PSYCHEDELIC_PHENOMENON_OPTIONS: Array<{
  id: PsychedelicPhenomenon;
  label: string;
}> = [
  { id: "altered_sensory_perception", label: "Altered sensory perception" },
  { id: "time_space_change", label: "Time / space perception change" },
  { id: "sense_of_self_change", label: "Sense-of-self / ego-boundary change" },
  { id: "somatic_response", label: "Somatic response" },
  { id: "emotional_release", label: "Emotional release" },
  { id: "dissociation", label: "Dissociative experience" },
  { id: "grounding_return", label: "Grounding / return" },
];

export type PsychedelicContext = {
  phase: PsychedelicPhase;
  treatmentModel: string;
  screeningReadiness: string;
  intention: string;
  supportPlan: string;
  medicineContext: string;
  administrationContext: string;
  monitoringObservations: string;
  phenomena: PsychedelicPhenomenon[];
  recoveryGrounding: string;
  integrationThemes: string;
  functionalImpact: string;
  providerNarrative: string;
};

const phases = new Set<PsychedelicPhase>([
  "none",
  "preparation",
  "medicine_session",
  "integration",
]);
const phenomena = new Set(PsychedelicPhenomenonOptionsIds());

function PsychedelicPhenomenonOptionsIds() {
  return PSYCHEDELIC_PHENOMENON_OPTIONS.map((item) => item.id);
}

function text(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

export function emptyPsychedelicContext(): PsychedelicContext {
  return {
    phase: "none",
    treatmentModel: "",
    screeningReadiness: "",
    intention: "",
    supportPlan: "",
    medicineContext: "",
    administrationContext: "",
    monitoringObservations: "",
    phenomena: [],
    recoveryGrounding: "",
    integrationThemes: "",
    functionalImpact: "",
    providerNarrative: "",
  };
}

export function normalizePsychedelicContext(value: unknown): PsychedelicContext {
  const source =
    value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
  const rawPhase = String(source.phase ?? "") as PsychedelicPhase;
  const rawPhenomena = source.phenomena;

  return {
    phase: phases.has(rawPhase) ? rawPhase : "none",
    treatmentModel: text(source.treatmentModel ?? source.treatment_model, 200),
    screeningReadiness: text(source.screeningReadiness ?? source.screening_readiness, 2000),
    intention: text(source.intention, 1500),
    supportPlan: text(source.supportPlan ?? source.support_plan, 2000),
    medicineContext: text(source.medicineContext ?? source.medicine_context, 1500),
    administrationContext: text(source.administrationContext ?? source.administration_context, 1500),
    monitoringObservations: text(source.monitoringObservations ?? source.monitoring_observations, 3000),
    phenomena: Array.isArray(rawPhenomena)
      ? [...new Set(rawPhenomena.map(String).filter(
          (item): item is PsychedelicPhenomenon => phenomena.has(item as PsychedelicPhenomenon),
        ))]
      : [],
    recoveryGrounding: text(source.recoveryGrounding ?? source.recovery_grounding, 2000),
    integrationThemes: text(source.integrationThemes ?? source.integration_themes, 3000),
    functionalImpact: text(source.functionalImpact ?? source.functional_impact, 2000),
    providerNarrative: text(source.providerNarrative ?? source.provider_narrative, 3000),
  };
}

export function psychedelicPhaseForTemplate(
  template: DocumentationTemplate,
): PsychedelicPhase {
  if (template === "pat_preparation") return "preparation";
  if (template === "kap_medicine_session") return "medicine_session";
  if (template === "pat_integration") return "integration";
  return "none";
}

export function isPsychedelicTemplate(template: DocumentationTemplate) {
  return psychedelicPhaseForTemplate(template) !== "none";
}

export function psychedelicContextForCarryForward(
  value: PsychedelicContext,
): PsychedelicContext {
  return {
    ...emptyPsychedelicContext(),
    treatmentModel: value.treatmentModel,
  };
}

const phenomenonLabels = new Map(
  PSYCHEDELIC_PHENOMENON_OPTIONS.map((item) => [item.id, item.label]),
);

export function formatPsychedelicContextForNote(context: PsychedelicContext) {
  if (context.phase === "none") return "";
  const lines = [
    "PAT / KAP SPECIALTY DOCUMENTATION",
    `Phase: ${context.phase.replaceAll("_", " ")}`,
  ];

  if (context.treatmentModel) lines.push(`Treatment model / context: ${context.treatmentModel}`);
  if (context.screeningReadiness) lines.push("", "Preparation / readiness", context.screeningReadiness);
  if (context.intention) lines.push("", "Patient-stated intention", context.intention);
  if (context.supportPlan) lines.push("", "Support / logistics plan", context.supportPlan);
  if (context.medicineContext) lines.push("", "Medicine / natural-medicine context", context.medicineContext);
  if (context.administrationContext) lines.push("", "Administration context", context.administrationContext);
  if (context.monitoringObservations) lines.push("", "Provider observations / monitoring", context.monitoringObservations);
  if (context.phenomena.length) {
    lines.push(
      "",
      "Provider-selected experience descriptors",
      context.phenomena.map((item) => phenomenonLabels.get(item) ?? item).join("; "),
    );
  }
  if (context.recoveryGrounding) lines.push("", "Recovery / grounding", context.recoveryGrounding);
  if (context.integrationThemes) lines.push("", "Integration themes", context.integrationThemes);
  if (context.functionalImpact) lines.push("", "Functional impact", context.functionalImpact);
  if (context.providerNarrative) lines.push("", "Provider narrative", context.providerNarrative);

  lines.push(
    "",
    "Documentation support only: this section records provider-entered observations and does not generate dosing recommendations, medication protocols, diagnoses, or payer coverage determinations.",
  );
  return lines.join("\n");
}
