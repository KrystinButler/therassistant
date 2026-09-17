export type SettingsSectionStatus = "Configured" | "Not Configured" | "Managed by Platform";

export type SettingsGroup =
  | "Practice"
  | "Care Delivery"
  | "Revenue Cycle"
  | "Engagement"
  | "Platform"
  | "Preferences";

export type AdminSettingsSlug =
  | "general"
  | "branding"
  | "locations"
  | "departments"
  | "clinicians"
  | "users"
  | "appointments"
  | "scheduling"
  | "clinical"
  | "documentation"
  | "compliance"
  | "payers"
  | "billing"
  | "notifications"
  | "patient-portal"
  | "integrations"
  | "security"
  | "data"
  | "my-account";

export type SettingsSection = {
  slug: AdminSettingsSlug;
  label: string;
  path: string;
  group: SettingsGroup;
};

export const ADMIN_SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { slug: "general", label: "General", path: "/settings/general", group: "Practice" },
  { slug: "branding", label: "Branding", path: "/settings/branding", group: "Practice" },
  { slug: "locations", label: "Locations", path: "/settings/locations", group: "Practice" },
  { slug: "departments", label: "Departments", path: "/settings/departments", group: "Practice" },
  { slug: "clinicians", label: "Clinicians", path: "/settings/clinicians", group: "Practice" },
  { slug: "users", label: "Users & Roles", path: "/settings/users", group: "Practice" },
  { slug: "appointments", label: "Appointments", path: "/settings/appointments", group: "Care Delivery" },
  { slug: "scheduling", label: "Scheduling", path: "/settings/scheduling", group: "Care Delivery" },
  { slug: "clinical", label: "Clinical", path: "/settings/clinical", group: "Care Delivery" },
  { slug: "documentation", label: "Documentation", path: "/settings/documentation", group: "Care Delivery" },
  { slug: "compliance", label: "Compliance", path: "/settings/compliance", group: "Care Delivery" },
  { slug: "payers", label: "Payers", path: "/settings/payers", group: "Revenue Cycle" },
  { slug: "billing", label: "Billing", path: "/settings/billing", group: "Revenue Cycle" },
  { slug: "notifications", label: "Notifications", path: "/settings/notifications", group: "Engagement" },
  { slug: "patient-portal", label: "Patient Portal", path: "/settings/patient-portal", group: "Engagement" },
  { slug: "integrations", label: "Integrations", path: "/settings/integrations", group: "Engagement" },
  { slug: "security", label: "Security", path: "/settings/security", group: "Platform" },
  { slug: "data", label: "Data", path: "/settings/data", group: "Platform" },
  { slug: "my-account", label: "My Account", path: "/settings/my-account", group: "Preferences" },
] as const;

export const MEMBER_SETTINGS_SECTIONS = [
  {
    slug: "my-account",
    label: "My Account",
    path: "/member/settings/my-account",
    group: "Preferences",
  },
] as const;

export const settingsRouteBySlug = Object.fromEntries(
  ADMIN_SETTINGS_SECTIONS.map((section) => [section.slug, section]),
) as Record<AdminSettingsSlug, SettingsSection>;

export const SETTINGS_LABELS_BY_SECTION: Record<AdminSettingsSlug, readonly string[]> = {
  general: ["Practice identity", "Default timezone"],
  branding: ["Logo", "Brand colors"],
  locations: ["Service locations"],
  departments: ["Departments"],
  clinicians: ["Clinician defaults"],
  users: ["Users", "Roles"],
  appointments: ["Appointment types"],
  scheduling: [],
  clinical: ["Clinical defaults"],
  documentation: ["Documentation rules"],
  compliance: ["Compliance controls"],
  payers: ["Payer defaults"],
  billing: [],
  notifications: ["Notification preferences"],
  "patient-portal": ["Portal access"],
  integrations: ["Connected services"],
  security: ["Security controls"],
  data: ["Data management"],
  "my-account": ["Profile", "Preferences"],
};

export const DEFAULT_SETTINGS_SECTION_STATUS: SettingsSectionStatus = "Not Configured";

export type SettingsSectionStatusOverrides = Partial<
  Record<AdminSettingsSlug, SettingsSectionStatus>
>;

export function getSettingsSectionStatus(
  slug: AdminSettingsSlug,
  overrides: SettingsSectionStatusOverrides = {},
): SettingsSectionStatus {
  return overrides[slug] ?? DEFAULT_SETTINGS_SECTION_STATUS;
}

function matchesRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function getSettingsSectionByRoute(pathname: string): SettingsSection | undefined {
  return ADMIN_SETTINGS_SECTIONS.find((section) => matchesRoute(pathname, section.path));
}
