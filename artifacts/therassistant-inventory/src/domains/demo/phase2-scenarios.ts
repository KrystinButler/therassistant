const JORDAN = "ff648f71-9c94-433c-9aab-f80b039a80fd";

export const phase2PatientChartScenarios = [
  { code: "complete_demographics", title: "Complete demographics and contacts", patientId: JORDAN, synthetic: true },
  { code: "multiple_insurance", title: "Primary and secondary insurance", patientId: JORDAN, synthetic: true },
  { code: "eligibility_history", title: "Eligibility and benefit history", patientId: JORDAN, synthetic: true },
  { code: "authorization_utilization", title: "Authorization unit utilization", patientId: JORDAN, synthetic: true },
  { code: "treatment_plan_goals", title: "Treatment plan and measurable goals", patientId: JORDAN, synthetic: true },
  { code: "documents", title: "Patient document metadata", patientId: JORDAN, synthetic: true },
  { code: "checkin", title: "Appointment check-in history", patientId: JORDAN, synthetic: true },
  { code: "journal", title: "Patient-authored journal", patientId: JORDAN, synthetic: true },
] as const;
