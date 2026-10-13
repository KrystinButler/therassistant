import {
  Bell,
  BookOpenText,
  BriefcaseBusiness,
  CalendarDays,
  ChartNoAxesCombined,
  ClipboardList,
  CreditCard,
  FileText,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Upload,
  UsersRound,
  UserRoundCog,
  type LucideIcon,
} from "lucide-react";

export type StaffNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  paths?: string[];
};

export type StaffNavGroup = {
  label: "HOME" | "REVENUE CYCLE" | "PRACTICE" | "ADMINISTRATION";
  items: StaffNavItem[];
};

export const STAFF_NAVIGATION: StaffNavGroup[] = [
  {
    label: "HOME",
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
      { label: "Schedule", href: "/schedule", icon: CalendarDays },
      { label: "Patients", href: "/clients", icon: UsersRound },
      { label: "Clinical", href: "/clinical", icon: FileText, paths: ["/encounters", "/clinical/golden-thread"] },
    ],
  },
  {
    label: "REVENUE CYCLE",
    items: [
      { label: "Charges", href: "/billing/charges", icon: ClipboardList, paths: ["/billing", "/charges"] },
      { label: "Claims", href: "/claims", icon: BriefcaseBusiness, paths: ["/rejections"] },
      { label: "Payments", href: "/payments", icon: CreditCard },
      { label: "Denials", href: "/denials", icon: ShieldCheck, paths: ["/ar-denials"] },
    ],
  },
  {
    label: "PRACTICE",
    items: [
      { label: "Providers", href: "/providers", icon: UserRoundCog },
      { label: "Credentialing", href: "/credentialing", icon: ClipboardList, paths: ["/payers", "/payers-contracts"] },
      { label: "Messaging", href: "/messaging", icon: BookOpenText },
      { label: "Patient Portal", href: "/portal-module", icon: Bell },
      { label: "Reports", href: "/reports", icon: ChartNoAxesCombined },
      { label: "Work Center", href: "/work-center", icon: BriefcaseBusiness },
    ],
  },
  {
    label: "ADMINISTRATION",
    items: [
      { label: "Practice Setup", href: "/organization-setup", icon: Settings, paths: ["/administration/practices"] },
      { label: "Users & Roles", href: "/administration/users", icon: UsersRound },
      { label: "Imports", href: "/administration/imports", icon: Upload },
      { label: "Audit", href: "/administration/audit", icon: ShieldCheck },
      { label: "Settings", href: "/administration", icon: Settings },
    ],
  },
];

function matches(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

export function getActiveStaffNavigationItem(path: string): StaffNavItem | undefined {
  const candidates = STAFF_NAVIGATION.flatMap((group) => group.items).flatMap((item) =>
    [item.href, ...(item.paths ?? [])]
      .filter((route) => matches(path, route))
      .map((route) => ({ item, specificity: route.length })),
  );

  candidates.sort((a, b) => b.specificity - a.specificity);
  return candidates[0]?.item;
}
