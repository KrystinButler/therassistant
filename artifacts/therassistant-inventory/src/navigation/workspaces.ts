export type WorkspaceId =
  | "overview"
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

export type NavigationChild = {
  id: string;
  label: string;
  href: string;
  matchPaths?: readonly string[];
  visibility: NavigationVisibility;
  badgeKey?: string;
};

export type WorkspaceDefinition = {
  id: WorkspaceId;
  label: string;
  renderInSidebar: boolean;
  primaryHref?: string;
  icon?: string;
  visibility: NavigationVisibility;
  badgeKey?: string;
  children: readonly NavigationChild[];
  contextualPaths?: readonly string[];
};

const visibleToAll = { mode: "all" } as const;

export const WORKSPACES: readonly WorkspaceDefinition[] = [
  {
    id: "overview",
    label: "Overview",
    renderInSidebar: true,
    primaryHref: "/",
    visibility: visibleToAll,
    children: [
      { id: "home", label: "Home", href: "/", visibility: visibleToAll },
      { id: "work-center", label: "Work Center", href: "/work-center", visibility: visibleToAll },
    ],
  },
  {
    id: "care-delivery",
    label: "Care delivery",
    renderInSidebar: true,
    primaryHref: "/clients",
    visibility: visibleToAll,
    children: [
      { id: "patients", label: "Patients", href: "/clients", visibility: visibleToAll },
      { id: "schedule", label: "Schedule", href: "/schedule", visibility: visibleToAll },
      { id: "clinical", label: "Clinical", href: "/clinical", visibility: visibleToAll },
      { id: "eligibility", label: "Eligibility & Benefits", href: "/eligibility", visibility: visibleToAll },
    ],
    contextualPaths: ["/encounters"],
  },
  {
    id: "revenue-cycle",
    label: "Revenue cycle",
    renderInSidebar: true,
    primaryHref: "/billing",
    visibility: visibleToAll,
    children: [
      { id: "billing", label: "Billing Overview", href: "/billing", visibility: visibleToAll },
      {
        id: "charge-capture",
        label: "Charge Capture",
        href: "/billing/charges",
        matchPaths: ["/charges"],
        visibility: visibleToAll,
      },
      { id: "claims", label: "Claims", href: "/claims", visibility: visibleToAll },
      {
        id: "claim-submission",
        label: "Claim Submission / 837P",
        href: "/claims/submission",
        visibility: visibleToAll,
      },
      {
        id: "claim-follow-up",
        label: "Claim Follow-Up",
        href: "/claims/follow-up",
        visibility: visibleToAll,
      },
      { id: "payments", label: "Payments", href: "/payments", visibility: visibleToAll },
      { id: "ar-denials", label: "A/R & Denials", href: "/ar-denials", visibility: visibleToAll },
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
      { id: "connected-operations", label: "Connected Operations", href: "/operations/connected", visibility: visibleToAll },
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
    label: "Client experience",
    renderInSidebar: true,
    primaryHref: "/journal",
    visibility: visibleToAll,
    children: [{ id: "journal", label: "Journal", href: "/journal", visibility: visibleToAll }],
    contextualPaths: ["/patient-portal"],
  },
  {
    id: "help-center",
    label: "Help center",
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
      { id: "users-roles", label: "Users & Roles", href: "/administration/users", visibility: visibleToAll },
      {
        id: "database-inventory",
        label: "Database Inventory",
        href: "/administration/database-inventory",
        visibility: visibleToAll,
      },
    ],
  },
] as const;

function matchesPath(pathname: string, candidate: string) {
  if (candidate === "/") return pathname === "/";
  return pathname === candidate || pathname.startsWith(`${candidate}/`);
}

type ChildMatch = {
  workspace: WorkspaceDefinition;
  child: NavigationChild;
  candidate: string;
};

function getBestChildMatch(pathname: string): ChildMatch | undefined {
  let best: ChildMatch | undefined;

  for (const workspace of WORKSPACES) {
    for (const child of workspace.children) {
      for (const candidate of [child.href, ...(child.matchPaths ?? [])]) {
        if (!matchesPath(pathname, candidate)) continue;
        if (!best || candidate.length > best.candidate.length) {
          best = { workspace, child, candidate };
        }
      }
    }
  }

  return best;
}

export function getVisibleWorkspaces(): readonly WorkspaceDefinition[] {
  return WORKSPACES.filter((workspace) => workspace.renderInSidebar);
}

export function getActiveChildForPath(pathname: string): NavigationChild | undefined {
  return getBestChildMatch(pathname)?.child;
}

export function getWorkspaceForPath(pathname: string): WorkspaceDefinition | undefined {
  const childMatch = getBestChildMatch(pathname);
  if (childMatch) return childMatch.workspace;

  let bestWorkspace: WorkspaceDefinition | undefined;
  let bestLength = -1;

  for (const workspace of WORKSPACES) {
    for (const candidate of workspace.contextualPaths ?? []) {
      if (matchesPath(pathname, candidate) && candidate.length > bestLength) {
        bestWorkspace = workspace;
        bestLength = candidate.length;
      }
    }
  }

  return bestWorkspace;
}

export function getWorkspaceContext(pathname: string): {
  workspace?: WorkspaceDefinition;
  child?: NavigationChild;
} {
  const childMatch = getBestChildMatch(pathname);
  if (childMatch) {
    return { workspace: childMatch.workspace, child: childMatch.child };
  }

  return { workspace: getWorkspaceForPath(pathname) };
}

export function toggleExpandedWorkspace(
  current: WorkspaceId | null,
  clicked: WorkspaceId,
): WorkspaceId | null {
  return current === clicked ? null : clicked;
}
