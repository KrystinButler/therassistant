import { SettingsPlaceholderPage } from "./SettingsOverviewPage";

const pages = {
  practice: ["Practice Information & Locations", "Change your practice name, contact information, timezone, and locations."],
  logo: ["Practice Logo", "Upload the logo used on printed documents and the Client Portal."],
  "patient-records": ["Patient Records", "Enable or disable optional features for patient records."],
  "client-portal": ["Client Portal", "Configure Client Portal access, balance limits, and optional features."],
  "service-codes": ["Service Codes", "Customize the CPT, HCPCS, and service codes used by the practice."],
  "diagnosis-codes": ["Diagnosis Codes", "Control which diagnosis codes appear in Therassistant searches."],
  interventions: ["Interventions", "Customize interventions used in Treatment Plans and Progress Notes."],
  "practice-billing": ["Practice Billing", "Configure practice-wide billing defaults and claim behavior."],
  "patient-billing": ["Patient Billing", "Configure patient billing, statements, thresholds, and payment-plan options."],
  "payment-processing": ["Payment Processing", "Configure secure payment processing for credit, debit, FSA, and HSA cards."],
  staff: ["Staff", "Add staff and manage account status, roles, and access."],
  "activity-log": ["Activity Log", "Search user activity and protected-health-information access history."],
  password: ["Change Your Password", "Update your password securely."],
} as const;

export type SettingsRouteId = keyof typeof pages;

export function SettingsRoutePage({ id }: { id: SettingsRouteId }) {
  const [title, description] = pages[id];
  return <SettingsPlaceholderPage title={title} description={description} />;
}
