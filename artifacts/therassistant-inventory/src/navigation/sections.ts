export type SectionId =
  | "care-delivery"
  | "revenue-cycle"
  | "operations"
  | "insights"
  | "client-experience"
  | "help-center"
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
    id: "care-delivery",
    label: "Care Delivery",
    renderInSidebar: true,
    primaryHref: "/clients",
    visibility: visibleToAll,
    children: [
      { id: "patients", label: "Patients", href: "/clients", visibility: visibleToAll },
      { id: "schedule", label: "Schedule", href: "/schedule", visibility: visibleToAll },
      { id: "clinical", label: "Clinical", href: "/clinical", visibility: visibleToAll },
      { id: "eligibility", label: "Eligibility & Benefits", href: "/eligibility", visibility: visibleToAll },
      { id: "authorizations", label: "Authorizations", href: "/authorizations", visibility: visibleToAll },
    ],
    contextualPaths: ["/encounters", "/medicaid"],
  },
  {
    id: "revenue-cycle",
    label: "Revenue Cycle",
    renderInSidebar: true,
    primaryHref: "/billing/charges",
    visibility: visibleToAll,
    children: [
      {
        id: "charges",
        label: "Charges",
        href: "/billing/charges",
        matchPaths: ["/charges", "/claims/submission"],
        visibility: visibleToAll,
      },
      { id: "rejections", label: "Rejections", href: "/rejections", visibility: visibleToAll },
      {
        id: "claims",
        label: "Claims",
        href: "/claims",
        matchPaths: ["/claims/follow-up"],
        visibility: visibleToAll,
      },
      {
        id: "denials",
        label: "Denials",
        href: "/denials",
        matchPaths: ["/ar-denials"],
        visibility: visibleToAll,
      },
      { id: "payments", label: "Payments", href: "/payments", visibility: visibleToAll },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    renderInSidebar: true,
    primaryHref: "/providers",
    visibility: visibleToAll,
    children: [
      { id: "providers", label: "Providers", href: "/providers", visibility: visibleToAll },
      { id: "credentialing", label: "Credentialing", href: "/credentialing", visibility: visibleToAll },
      {
        id: "payers-contracts",
        label: "Payers & Contracts",
        href: "/payers-contracts",
        matchPaths: ["/payers"],
        visibility: visibleToAll,
      },
      { id: "mailroom", label: "Mailroom", href: "/mailroom", visibility: visibleToAll },
      {
        id: "imports",
        label: "Imports / Migration",
        href: "/administration/imports",
        visibility: visibleToAll,
      },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    renderInSidebar: true,
    primaryHref: "/reports",
    visibility: visibleToAll,
    children: [{ id: "reports", label: "Reports", href: "/reports", visibility: visibleToAll }],
  },
  {
    id: "client-experience",
    label: "Client Experience",
    renderInSidebar: true,
    primaryHref: "/journal",
    visibility: visibleToAll,
    children: [{ id: "journal", label: "Journal", href: "/journal", visibility: visibleToAll }],
    contextualPaths: ["/patient-portal"],
  },
  {
    id: "help-center",
    label: "Help Center",
    renderInSidebar: false,
    visibility: visibleToAll,
    children: [],
  },
  {
    id: "settings",
    label: "Settings",
    renderInSidebar: true,
    primaryHref: "/administration",
    visibility: visibleToAll,
    children: [
      { id: "administration", label: "Administration", href: "/administration", visibility: visibleToAll },
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
