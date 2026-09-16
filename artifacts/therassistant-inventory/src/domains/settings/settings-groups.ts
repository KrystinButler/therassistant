export type SettingsItem = {
  id: string;
  label: string;
  href: string;
  description: string;
};

export type SettingsGroup = {
  id: string;
  label: string;
  items: readonly SettingsItem[];
};

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    id: "practice",
    label: "Practice",
    items: [
      {
        id: "practice-information-locations",
        label: "Practice Information & Locations",
        href: "/settings/practice",
        description: "Change your practice name, contact information, timezone, and locations.",
      },
      {
        id: "practice-logo",
        label: "Practice Logo",
        href: "/settings/logo",
        description: "Upload the logo used on printed documents and the Client Portal.",
      },
      {
        id: "patient-records",
        label: "Patient Records",
        href: "/settings/patient-records",
        description: "Enable or disable optional features for patient records.",
      },
      {
        id: "client-portal",
        label: "Client Portal",
        href: "/settings/client-portal",
        description: "Configure Client Portal access, balance limits, and optional features.",
      },
    ],
  },
  {
    id: "clinical",
    label: "Clinical",
    items: [
      {
        id: "service-codes",
        label: "Service Codes",
        href: "/settings/service-codes",
        description: "Customize the CPT, HCPCS, and service codes used by the practice.",
      },
      {
        id: "diagnosis-codes",
        label: "Diagnosis Codes",
        href: "/settings/diagnosis-codes",
        description: "Control which diagnosis codes appear in Therassistant searches.",
      },
      {
        id: "interventions",
        label: "Interventions",
        href: "/settings/interventions",
        description: "Customize interventions used in Treatment Plans and Progress Notes.",
      },
    ],
  },
  {
    id: "billing",
    label: "Billing",
    items: [
      {
        id: "practice-billing",
        label: "Practice Billing",
        href: "/settings/practice-billing",
        description: "Configure practice-wide billing defaults and claim behavior.",
      },
      {
        id: "patient-billing",
        label: "Patient Billing",
        href: "/settings/patient-billing",
        description: "Configure patient billing, statements, thresholds, and payment-plan options.",
      },
      {
        id: "payment-processing",
        label: "Payment Processing",
        href: "/settings/payment-processing",
        description: "Configure secure payment processing for credit, debit, FSA, and HSA cards.",
      },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    items: [
      {
        id: "staff",
        label: "Staff",
        href: "/settings/staff",
        description: "Add staff and manage account status, roles, and access.",
      },
      {
        id: "activity-log",
        label: "Activity Log",
        href: "/settings/activity-log",
        description: "Search user activity and protected-health-information access history.",
      },
    ],
  },
  {
    id: "my-account",
    label: "My Account",
    items: [
      {
        id: "change-password",
        label: "Change Your Password",
        href: "/settings/password",
        description: "Update your password securely.",
      },
    ],
  },
] as const;

export function getSettingsItem(id: string) {
  return SETTINGS_GROUPS.flatMap((group) => group.items).find((item) => item.id === id);
}
