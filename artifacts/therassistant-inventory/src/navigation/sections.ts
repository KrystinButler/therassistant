export type SectionId =
  | "engage"
  | "prepare"
  | "document"
  | "get-paid"
  | "operate"
  | "settings";

export type NavigationVisibility =
  | { mode: "all" }
  | { mode: "roles"; roles: readonly string[] };

export type NavigationItem = {
  id: string;
  label: string;
  href: string;
  matchPaths?: readonly string[];
  visibility: NavigationVisibility;
  badgeKey?: string;
};

export type NavigationSection = {
  id: SectionId;
  label: string;
  renderInSidebar: boolean;
  primaryHref?: string;
  visibility: NavigationVisibility;
  children: readonly NavigationItem[];
  contextualPaths?: readonly string[];
};

const visibleToAll = { mode: "all" } as const;

export const NAV_SECTIONS: readonly NavigationSection[] = [
  {
    id: "engage",
    label: "ENGAGE",
    renderInSidebar: true,
    primaryHref: "/clients",
    visibility: visibleToAll,
    children: [
      { id: "patients", label: "Patients", href: "/clients", visibility: visibleToAll },
      { id: "journal", label: "Patient Journal", href: "/journal", visibility: visibleToAll },
    ],
    contextualPaths: ["/patient-portal"],
  },
  {
    id: "prepare",
    label: "PREPARE",
    renderInSidebar: true,
    primaryHref: "/schedule",
    visibility: visibleToAll,
    children: [
      { id: "schedule", label: "Schedule & Pre-Session", href: "/schedule", visibility: visibleToAll },
      { id: "eligibility", label: "Eligibility & Benefits", href: "/eligibility", visibility: visibleToAll },
    ],
  },
  {
    id: "document",
    label: "DOCUMENT",
    renderInSidebar: true,
    primaryHref: "/clinical",
    visibility: visibleToAll,
    children: [
      { id: "clinical", label: "Clinical Documentation", href: "/clinical", visibility: visibleToAll },
    ],
    contextualPaths: ["/encounters", "/clinical/golden-thread"],
  },
  {
    id: "get-paid",
    label: "GET PAID",
    renderInSidebar: true,
    primaryHref: "/billing/charges",
    visibility: visibleToAll,
    children: [
      {
        id: "charges",
        label: "Charge Capture",
        href: "/billing/charges",
        matchPaths: ["/charges", "/claims/submission"],
        visibility: visibleToAll,
      },
      { id: "rejections", label: "Claim Rejections", href: "/rejections", visibility: visibleToAll },
      {
        id: "claims",
        label: "Claims & 837P",
        href: "/claims",
        matchPaths: ["/claims/follow-up"],
        visibility: visibleToAll,
      },
      {
        id: "denials",
        label: "Denials & Appeals",
        href: "/denials",
        matchPaths: ["/ar-denials"],
        visibility: visibleToAll,
      },
      { id: "payments", label: "Payments & ERA", href: "/payments", visibility: visibleToAll },
    ],
  },
  {
    id: "operate",
    label: "OPERATE",
    renderInSidebar: true,
    primaryHref: "/work-center",
    visibility: visibleToAll,
    children: [
      { id: "work-center", label: "Work Center", href: "/work-center", visibility: visibleToAll },
      { id: "providers", label: "Providers", href: "/providers", visibility: visibleToAll },
      { id: "credentialing", label: "Credentialing", href: "/credentialing", visibility: visibleToAll },
      {
        id: "payers-contracts",
        label: "Payers & Contracts",
        href: "/payers-contracts",
        matchPaths: ["/payers"],
        visibility: visibleToAll,
      },
      { id: "reports", label: "Reports", href: "/reports", visibility: visibleToAll },
      {
        id: "imports",
        label: "Imports / Migration",
        href: "/administration/imports",
        visibility: visibleToAll,
      },
    ],
  },
  {
    id: "settings",
    label: "SETTINGS",
    renderInSidebar: true,
    primaryHref: "/administration",
    visibility: visibleToAll,
    children: [
      { id: "administration", label: "Administration", href: "/administration", visibility: visibleToAll },
      { id: "program-templates", label: "Program Templates", href: "/administration/program-templates", visibility: visibleToAll },
      { id: "audit", label: "Audit History", href: "/administration/audit", visibility: visibleToAll },
    ],
  },
] as const;

function matchesPath(pathname: string, candidate: string) {
  if (candidate === "/") return pathname === "/";
  return pathname === candidate || pathname.startsWith(`${candidate}/`);
}

type ItemMatch = {
  section: NavigationSection;
  item: NavigationItem;
  candidate: string;
};

function getBestItemMatch(pathname: string): ItemMatch | undefined {
  let best: ItemMatch | undefined;

  for (const section of NAV_SECTIONS) {
    for (const item of section.children) {
      for (const candidate of [item.href, ...(item.matchPaths ?? [])]) {
        if (!matchesPath(pathname, candidate)) continue;
        if (!best || candidate.length > best.candidate.length) {
          best = { section, item, candidate };
        }
      }
    }
  }

  return best;
}

export function getVisibleSections(): readonly NavigationSection[] {
  return NAV_SECTIONS.filter((section) => section.renderInSidebar);
}

export function getActiveItemForPath(pathname: string): NavigationItem | undefined {
  return getBestItemMatch(pathname)?.item;
}

export function getSectionForPath(pathname: string): NavigationSection | undefined {
  const itemMatch = getBestItemMatch(pathname);
  if (itemMatch) return itemMatch.section;

  let bestSection: NavigationSection | undefined;
  let bestLength = -1;
  for (const section of NAV_SECTIONS) {
    for (const candidate of section.contextualPaths ?? []) {
      if (matchesPath(pathname, candidate) && candidate.length > bestLength) {
        bestSection = section;
        bestLength = candidate.length;
      }
    }
  }
  return bestSection;
}

export function getNavigationContext(pathname: string): {
  section?: NavigationSection;
  item?: NavigationItem;
} {
  const itemMatch = getBestItemMatch(pathname);
  if (itemMatch) return { section: itemMatch.section, item: itemMatch.item };
  return { section: getSectionForPath(pathname) };
}

export function toggleExpandedSection(current: SectionId | null, clicked: SectionId): SectionId | null {
  return current === clicked ? null : clicked;
}
