export type EncounterNoteTemplate = "psychotherapy" | "assessment" | "crisis" | "case_management" | "medication_management";
export function noteTypeForService(value: string): EncounterNoteTemplate {
  const service = value.toLowerCase();
  if (service.includes("crisis")) return "crisis";
  if (/assessment|intake|evaluation/.test(service)) return "assessment";
  if (/medication|psychiatric/.test(service)) return "medication_management";
  if (service.includes("case management")) return "case_management";
  return "psychotherapy";
}
export function noteTemplateLabelForService(value: string): string {
  switch (noteTypeForService(value)) {
    case "crisis": return "Crisis Note";
    case "medication_management": return "Medication Management Note";
    case "assessment": return "Clinical Assessment";
    case "case_management": return "Case Management Note";
    default: return "Psychotherapy Progress Note";
  }
}
