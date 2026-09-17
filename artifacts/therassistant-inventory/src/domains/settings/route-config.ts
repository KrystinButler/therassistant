import {
  ADMIN_SETTINGS_SECTIONS,
  MEMBER_SETTINGS_SECTIONS,
  type SettingsGroup,
} from "./model";

export const ADMIN_SETTINGS_ROOT = "/settings";
export const ADMIN_SETTINGS_DEFAULT_PATH = "/settings/general";
export const MEMBER_SETTINGS_ROOT = "/member/settings";
export const MEMBER_SETTINGS_DEFAULT_PATH = "/member/settings/my-account";

export const SETTINGS_GROUP_ORDER = [
  "Practice",
  "Care Delivery",
  "Revenue Cycle",
  "Engagement",
  "Platform",
  "Preferences",
] as const satisfies readonly SettingsGroup[];

export const ADMIN_SETTINGS_GROUPS = SETTINGS_GROUP_ORDER.map((label) => ({
  label,
  items: ADMIN_SETTINGS_SECTIONS.filter((section) => section.group === label),
}));

export const MEMBER_SETTINGS_GROUPS = [
  {
    label: "Preferences" as const,
    items: MEMBER_SETTINGS_SECTIONS,
  },
] as const;
