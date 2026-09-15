# THERASSISTANT Workspace Navigation Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the Vercel staff navigation so the ChatGPT Therassistant workspace hierarchy is canonical while preserving all existing workflow routes and domain behavior.

**Architecture:** Move route ownership and sidebar metadata into one pure TypeScript navigation model, then make `AppShell` render a one-workspace-at-a-time accordion from that model. Route matching remains URL-derived so deep links, browser navigation, contextual record pages, and existing workflow routes keep working without route renames. Styling stays in the existing navy-and-sage demo stylesheet; the separate patient-facing shell remains outside this project.

**Tech Stack:** React 19, TypeScript 5.9, Wouter 3, Vite 7, Node 24 test runner with `tsx`, existing CSS in `src/index.css`.

**Spec:** `docs/superpowers/specs/2026-09-15-navigation-workspace-refactor-design.md`

## Global Constraints

- The ChatGPT Therassistant site is the canonical information architecture.
- Canonical workspace order is: Overview, Care delivery, Revenue cycle, Operations, Insights, Client experience, Help center, Settings.
- Help center remains canonical metadata but is not rendered as a clickable destination until a real route exists.
- Preserve current route URLs; do not rename routes to match labels.
- Preserve existing domain workflow code and repositories.
- `/administration/imports` remains a route but belongs to Operations in navigation.
- `/patient-portal/:clientId` belongs to Client experience contextually but is not exposed as a generic staff child link.
- Do not implement the Phase 6 separate patient-facing shell in this project.
- Use the existing Therassistant navy-and-sage visual system.
- Keep the production TypeScript gate as `typecheck:phase3`.
- Do not expose raw UUIDs or route fragments as navigation labels.
- Existing Phase 2-5 tests, browser secret scan, build, and representative route smoke checks must remain green.

---

## File Structure

### Create

- `artifacts/therassistant-inventory/src/navigation/workspaces.ts`
  - Single source of truth for workspace metadata, visible child links, contextual route ownership, safe primary destinations, future role visibility metadata, optional badge sources, and route-to-workspace helpers.
- `artifacts/therassistant-inventory/tests/navigation-workspaces.test.ts`
  - Pure deterministic tests for canonical order, route ownership, visible children, contextual routes, metadata, and accordion state helper behavior.

### Modify

- `artifacts/therassistant-inventory/src/components/app-shell.tsx`
  - Replace the flat `navigation` array with workspace accordion rendering driven by `workspaces.ts`.
  - Show current practice plus workspace/child context in the top bar.
  - Add semantic accordion controls and active-link state.
- `artifacts/therassistant-inventory/src/index.css`
  - Add workspace-group, child-link, chevron, active-state, focus-visible, top-bar context, and responsive drawer/stack rules using the existing navy/sage variables.
- `artifacts/therassistant-inventory/tsconfig.phase3.json`
  - Include `src/navigation/**/*.ts` so the production TypeScript gate covers the new navigation model.
- `docs/superpowers/specs/2026-09-15-navigation-workspace-refactor-design.md`
  - After all verification passes, change status from `Approved design, pending implementation plan` to `Implemented and verified`.

### Do not modify unless verification exposes a real compatibility defect

- `artifacts/therassistant-inventory/src/App.tsx`
- Domain pages under `src/domains/**`
- Supabase schema/migrations
- Phase 2-5 workflow logic

---

### Task 1: Build the canonical workspace model and route ownership tests

**Files:**
- Create: `artifacts/therassistant-inventory/src/navigation/workspaces.ts`
- Create: `artifacts/therassistant-inventory/tests/navigation-workspaces.test.ts`
- Modify: `artifacts/therassistant-inventory/tsconfig.phase3.json`

**Interfaces:**
- Produces:
  - `type WorkspaceId = "overview" | "care-delivery" | "revenue-cycle" | "operations" | "insights" | "client-experience" | "help-center" | "settings"`
  - `type NavigationVisibility`
  - `type NavigationChild`
  - `type WorkspaceDefinition`
  - `const WORKSPACES: readonly WorkspaceDefinition[]`
  - `getVisibleWorkspaces(): readonly WorkspaceDefinition[]`
  - `getWorkspaceForPath(pathname: string): WorkspaceDefinition | undefined`
  - `getActiveChildForPath(pathname: string): NavigationChild | undefined`
  - `getWorkspaceContext(pathname: string): { workspace?: WorkspaceDefinition; child?: NavigationChild }`
  - `toggleExpandedWorkspace(current: WorkspaceId | null, clicked: WorkspaceId): WorkspaceId | null`
- Consumed by: Task 2 `AppShell`.

- [ ] **Step 1: Write the failing navigation model tests**

Create `artifacts/therassistant-inventory/tests/navigation-workspaces.test.ts` with the exact behavioral coverage below:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKSPACES,
  getVisibleWorkspaces,
  getWorkspaceForPath,
  getActiveChildForPath,
  getWorkspaceContext,
  toggleExpandedWorkspace,
} from "../src/navigation/workspaces.ts";

const workspaceId = (path: string) => getWorkspaceForPath(path)?.id;
const childLabel = (path: string) => getActiveChildForPath(path)?.label;

test("canonical workspace order matches the ChatGPT Therassistant site", () => {
  assert.deepEqual(
    WORKSPACES.map((workspace) => workspace.label),
    [
      "Overview",
      "Care delivery",
      "Revenue cycle",
      "Operations",
      "Insights",
      "Client experience",
      "Help center",
      "Settings",
    ],
  );
});

test("Help center remains canonical but is not rendered until a route exists", () => {
  const help = WORKSPACES.find((workspace) => workspace.id === "help-center");
  assert.equal(help?.renderInSidebar, false);
  assert.equal(help?.primaryHref, undefined);
  assert.equal(getVisibleWorkspaces().some((workspace) => workspace.id === "help-center"), false);
});

test("workspace metadata keeps safe primary destinations and future visibility fields", () => {
  assert.equal(WORKSPACES.find((workspace) => workspace.id === "overview")?.primaryHref, "/");
  assert.equal(WORKSPACES.find((workspace) => workspace.id === "revenue-cycle")?.primaryHref, "/billing");
  assert.equal(WORKSPACES.find((workspace) => workspace.id === "settings")?.primaryHref, "/administration");
  for (const workspace of WORKSPACES) assert.equal(workspace.visibility.mode, "all");
});

test("primary routes map to the owning workspace", () => {
  const cases: Array<[string, string]> = [
    ["/", "overview"],
    ["/work-center", "overview"],
    ["/clients", "care-delivery"],
    ["/schedule", "care-delivery"],
    ["/clinical", "care-delivery"],
    ["/eligibility", "care-delivery"],
    ["/authorizations", "care-delivery"],
    ["/billing", "revenue-cycle"],
    ["/billing/charges", "revenue-cycle"],
    ["/charges", "revenue-cycle"],
    ["/claims", "revenue-cycle"],
    ["/claims/submission", "revenue-cycle"],
    ["/claims/follow-up", "revenue-cycle"],
    ["/payments", "revenue-cycle"],
    ["/ar-denials", "revenue-cycle"],
    ["/providers", "operations"],
    ["/credentialing", "operations"],
    ["/payers-contracts", "operations"],
    ["/mailroom", "operations"],
    ["/administration/imports", "operations"],
    ["/reports", "insights"],
    ["/journal", "client-experience"],
    ["/administration", "settings"],
    ["/administration/database-inventory", "settings"],
  ];

  for (const [path, expected] of cases) assert.equal(workspaceId(path), expected, path);
});

test("contextual record routes keep their owning workspace active", () => {
  const cases: Array<[string, string]> = [
    ["/clients/11111111-1111-4111-8111-111111111111", "care-delivery"],
    ["/schedule/22222222-2222-4222-8222-222222222222", "care-delivery"],
    ["/encounters/33333333-3333-4333-8333-333333333333", "care-delivery"],
    ["/clinical/golden-thread/44444444-4444-4444-8444-444444444444", "care-delivery"],
    ["/medicaid", "care-delivery"],
    ["/claims/55555555-5555-4555-8555-555555555555", "revenue-cycle"],
    ["/providers/66666666-6666-4666-8666-666666666666", "operations"],
    ["/payers/77777777-7777-4777-8777-777777777777", "operations"],
    ["/mailroom/75000000-0000-4000-8000-000000000001", "operations"],
    ["/patient-portal/88888888-8888-4888-8888-888888888888", "client-experience"],
  ];

  for (const [path, expected] of cases) assert.equal(workspaceId(path), expected, path);
});

test("specific children win over broader route prefixes", () => {
  assert.equal(childLabel("/claims/submission"), "Claim Submission / 837P");
  assert.equal(childLabel("/claims/follow-up"), "Claim Follow-Up");
  assert.equal(childLabel("/billing/charges"), "Charge Capture");
  assert.equal(childLabel("/administration/imports"), "Imports / Migration");
  assert.equal(childLabel("/administration/database-inventory"), "Database Inventory");
  assert.equal(childLabel("/payers/payer-1"), "Payers & Contracts");
});

test("patient portal is contextual and not a generic staff child link", () => {
  const workspace = WORKSPACES.find((item) => item.id === "client-experience");
  assert.deepEqual(workspace?.children.map((child) => child.label), ["Journal"]);
  assert.equal(workspaceId("/patient-portal/patient-1"), "client-experience");
  assert.equal(childLabel("/patient-portal/patient-1"), undefined);
});

test("navigation labels never expose ids or raw route fragments", () => {
  const labels = WORKSPACES.flatMap((workspace) => [workspace.label, ...workspace.children.map((child) => child.label)]);
  for (const label of labels) {
    assert.equal(label.includes(":"), false, label);
    assert.equal(/[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(label), false, label);
  }
});

test("workspace context returns both workspace and active child when available", () => {
  const context = getWorkspaceContext("/claims/submission");
  assert.equal(context.workspace?.label, "Revenue cycle");
  assert.equal(context.child?.label, "Claim Submission / 837P");
});

test("accordion toggle allows at most one expanded workspace", () => {
  assert.equal(toggleExpandedWorkspace(null, "overview"), "overview");
  assert.equal(toggleExpandedWorkspace("overview", "revenue-cycle"), "revenue-cycle");
  assert.equal(toggleExpandedWorkspace("revenue-cycle", "revenue-cycle"), null);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run from repository root:

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/navigation-workspaces.test.ts
```

Expected: FAIL because `../src/navigation/workspaces.ts` does not exist.

- [ ] **Step 3: Implement the navigation model**

Create `artifacts/therassistant-inventory/src/navigation/workspaces.ts` using these exact public types and matching semantics:

```ts
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
```

Populate `WORKSPACES` in canonical order with `visibility: { mode: "all" }` on every workspace and child. Badge keys remain optional metadata and are not wired to counts in this refactor.

Use these safe workspace primary destinations:

- Overview: `/`
- Care delivery: `/clients`
- Revenue cycle: `/billing`
- Operations: `/providers`
- Insights: `/reports`
- Client experience: `/journal`
- Help center: no `primaryHref`
- Settings: `/administration`

Use these visible children:

- Overview: Home `/`, Work Center `/work-center`
- Care delivery: Patients `/clients`, Schedule `/schedule`, Clinical `/clinical`, Eligibility & Benefits `/eligibility`, Authorizations `/authorizations`
- Revenue cycle: Billing Overview `/billing`, Charge Capture `/billing/charges` with alias match `/charges`, Claims `/claims`, Claim Submission / 837P `/claims/submission`, Claim Follow-Up `/claims/follow-up`, Payments `/payments`, A/R & Denials `/ar-denials`
- Operations: Providers `/providers`, Credentialing `/credentialing`, Payers & Contracts `/payers-contracts` with contextual match `/payers`, Mailroom `/mailroom`, Imports / Migration `/administration/imports`
- Insights: Reports `/reports`
- Client experience: Journal `/journal`
- Help center: no children, `renderInSidebar: false`
- Settings: Administration `/administration`, Database Inventory `/administration/database-inventory`

Use contextual workspace paths for routes without a visible generic child:

```ts
care-delivery: ["/encounters", "/medicaid"]
client-experience: ["/patient-portal"]
```

Matching rules must be deterministic:

```ts
function matchesPath(pathname: string, candidate: string) {
  if (candidate === "/") return pathname === "/";
  return pathname === candidate || pathname.startsWith(`${candidate}/`);
}
```

When selecting an active child, collect each child's `href` and `matchPaths`, match them, then choose the child whose matching candidate has the greatest string length. This prevents `/claims` from stealing `/claims/submission` and prevents `/administration` from stealing `/administration/database-inventory`.

When selecting a workspace:

1. Find the best active child match across all workspaces using the same longest-match rule.
2. If none exists, match `contextualPaths` using longest path first.
3. Return `undefined` for an unmapped route instead of throwing.

Implement `getVisibleWorkspaces()` as `WORKSPACES.filter((workspace) => workspace.renderInSidebar)`.

Implement `toggleExpandedWorkspace(current, clicked)` as:

```ts
return current === clicked ? null : clicked;
```

Do not enforce role visibility or badge counts yet; this task only preserves the metadata contract required for later role-aware navigation without another structural redesign.

- [ ] **Step 4: Add the navigation model to the production typecheck gate**

In `artifacts/therassistant-inventory/tsconfig.phase3.json`, add:

```json
"src/navigation/**/*.ts",
```

inside `include`, immediately after the domain globs.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/navigation-workspaces.test.ts
pnpm --filter @workspace/therassistant-inventory run typecheck:phase3
```

Expected: all navigation tests PASS and Phase 3 typecheck PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add artifacts/therassistant-inventory/src/navigation/workspaces.ts \
  artifacts/therassistant-inventory/tests/navigation-workspaces.test.ts \
  artifacts/therassistant-inventory/tsconfig.phase3.json
git commit -m "feat: add canonical workspace navigation model"
```

---

### Task 2: Refactor AppShell into the workspace-first accordion

**Files:**
- Modify: `artifacts/therassistant-inventory/src/components/app-shell.tsx`
- Modify: `artifacts/therassistant-inventory/tests/navigation-workspaces.test.ts`

**Interfaces:**
- Consumes from Task 1:
  - `getVisibleWorkspaces()`
  - `getWorkspaceContext(pathname)`
  - `toggleExpandedWorkspace(current, clicked)`
  - `WorkspaceId`
- Produces:
  - Sidebar rendered from workspace configuration rather than a hard-coded flat route list.
  - URL-derived active workspace and active child.
  - One user-expanded workspace at a time.
  - Top-bar practice context plus `Workspace · Child` when a child is active, otherwise just `Workspace`.

- [ ] **Step 1: Extend the focused test for fallback and label context behavior**

Add to `navigation-workspaces.test.ts`:

```ts
test("unmapped paths fail soft instead of inventing an owner", () => {
  const context = getWorkspaceContext("/not-a-real-route");
  assert.equal(context.workspace, undefined);
  assert.equal(context.child, undefined);
});

test("contextual record routes may have a workspace without a visible child", () => {
  const portal = getWorkspaceContext("/patient-portal/patient-1");
  assert.equal(portal.workspace?.label, "Client experience");
  assert.equal(portal.child, undefined);

  const encounter = getWorkspaceContext("/encounters/encounter-1");
  assert.equal(encounter.workspace?.label, "Care delivery");
  assert.equal(encounter.child, undefined);
});
```

- [ ] **Step 2: Run focused tests before changing the shell**

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/navigation-workspaces.test.ts
```

Expected: PASS. These tests lock the route semantics that the shell must consume.

- [ ] **Step 3: Replace the flat sidebar implementation**

In `app-shell.tsx`:

1. Import React state/effect helpers and the navigation model:

```ts
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  getVisibleWorkspaces,
  getWorkspaceContext,
  toggleExpandedWorkspace,
  type WorkspaceId,
} from "../navigation/workspaces";
```

2. Delete the current flat `navigation` array and local `active(href)` function.

3. Derive route context:

```ts
const [location] = useLocation();
const context = getWorkspaceContext(location);
const activeWorkspaceId = context.workspace?.id ?? null;
const [expandedWorkspaceId, setExpandedWorkspaceId] = useState<WorkspaceId | null>(activeWorkspaceId);

useEffect(() => {
  if (activeWorkspaceId) setExpandedWorkspaceId(activeWorkspaceId);
}, [activeWorkspaceId]);
```

4. Render `getVisibleWorkspaces()` as workspace groups. Each group must use:

- semantic `<button type="button">` for expand/collapse;
- `aria-expanded={expanded}`;
- `aria-controls={`thera-workspace-${workspace.id}`}`;
- a text label and a simple text chevron such as `⌄`/`›` or a CSS-drawn indicator; do not add a new icon dependency;
- `active` class on the workspace button when `workspace.id === activeWorkspaceId`;
- child `<Link>` elements only when that workspace is expanded;
- `aria-current="page"` on the active visible child.

5. Clicking a workspace button changes only expanded state:

```ts
setExpandedWorkspaceId((current) => toggleExpandedWorkspace(current, workspace.id));
```

It must not navigate or change the current route.

6. Render child links from `workspace.children`; do not hard-code route names in JSX.

7. Keep patient portal absent from visible children because it is contextual only.

8. Keep Help center absent because `getVisibleWorkspaces()` filters it.

- [ ] **Step 4: Update the top bar to show practice plus current workspace context**

Derive the route label:

```ts
const topbarContext = context.workspace
  ? context.child
    ? `${context.workspace.label} · ${context.child.label}`
    : context.workspace.label
  : "Operational Workspace";
```

Replace the single fixed top-bar label with:

```tsx
<div className="thera-topbar-context">
  <div className="thera-topbar-practice">Front Range Behavioral Health</div>
  <div className="thera-topbar-product">{topbarContext}</div>
</div>
```

Keep the existing synthetic-demo status chip on the right. Do not add duplicate top-level navigation to the top bar.

- [ ] **Step 5: Run focused tests, typecheck, and build**

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/navigation-workspaces.test.ts
pnpm --filter @workspace/therassistant-inventory run typecheck:phase3
pnpm --filter @workspace/therassistant-inventory run build
```

Expected: tests PASS, typecheck PASS, build PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add artifacts/therassistant-inventory/src/components/app-shell.tsx \
  artifacts/therassistant-inventory/tests/navigation-workspaces.test.ts
git commit -m "feat: render workspace-first sidebar navigation"
```

---

### Task 3: Apply navy-and-sage hierarchy, focus states, and responsive navigation behavior

**Files:**
- Modify: `artifacts/therassistant-inventory/src/index.css`
- Modify: `artifacts/therassistant-inventory/src/components/app-shell.tsx`

**Interfaces:**
- Consumes: Task 2 workspace markup/class names.
- Produces: Clear visual distinction between workspace controls and child workflows, accessible focus treatment, active sage state, readable practice/workspace top-bar context, and usable small-screen behavior.

- [ ] **Step 1: Add stable class names to the Task 2 markup**

Use these class names in `app-shell.tsx` so styling remains explicit and inspectable:

```text
thera-workspace
thera-workspace-button
thera-workspace-button active
thera-workspace-label
thera-workspace-chevron
thera-workspace-children
thera-workspace-child
thera-workspace-child active
thera-topbar-context
thera-topbar-practice
thera-sidebar-backdrop
thera-sidebar-toggle
```

Keep the existing `.thera-sidebar`, `.thera-nav`, `.thera-brand`, and footer classes.

- [ ] **Step 2: Add a small-screen sidebar toggle without introducing a second navigation model**

In `AppShell`, add:

```ts
const [mobileNavOpen, setMobileNavOpen] = useState(false);
```

Add a top-bar button with class `thera-sidebar-toggle`, `aria-label="Open navigation"`, and `aria-expanded={mobileNavOpen}` that toggles the mobile drawer.

When `mobileNavOpen` is true:

- add class `mobile-open` to `.thera-sidebar`;
- render a button `.thera-sidebar-backdrop` with `aria-label="Close navigation"` that closes the drawer;
- close the drawer when any child link is selected using `onClick={() => setMobileNavOpen(false)}`.

Desktop behavior must remain unchanged.

- [ ] **Step 3: Replace the flat-link CSS with workspace hierarchy styles**

In the existing THERASSISTANT WORKING DEMO section of `index.css`, retain the current color variables and add/replace navigation rules with these design requirements:

```css
.thera-nav {
  padding: 12px 9px;
  flex: 1;
}

.thera-workspace {
  margin: 2px 0;
}

.thera-workspace-button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 0;
  background: transparent;
  color: #dce4e9;
  padding: 10px 12px;
  border-radius: 7px;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}

.thera-workspace-button:hover,
.thera-workspace-button.active {
  background: rgba(255,255,255,.07);
}

.thera-workspace-button.active {
  color: white;
}

.thera-workspace-button:focus-visible,
.thera-workspace-child:focus-visible,
.thera-sidebar-toggle:focus-visible,
.thera-sidebar-backdrop:focus-visible {
  outline: 2px solid var(--thera-sage);
  outline-offset: 2px;
}

.thera-workspace-chevron {
  color: var(--thera-sage);
  font-size: 12px;
}

.thera-workspace-children {
  display: grid;
  gap: 2px;
  padding: 2px 0 6px 12px;
}

.thera-workspace-child {
  display: block;
  color: #bfcbd2;
  text-decoration: none;
  padding: 8px 10px 8px 15px;
  border-left: 2px solid rgba(159,181,165,.22);
  border-radius: 0 7px 7px 0;
  font-size: 12px;
}

.thera-workspace-child:hover {
  color: white;
  background: rgba(255,255,255,.05);
}

.thera-workspace-child.active {
  color: var(--thera-navy-deep);
  background: var(--thera-sage);
  border-left-color: var(--thera-sage);
  font-weight: 800;
}

.thera-topbar-context {
  min-width: 0;
}

.thera-topbar-practice {
  color: var(--thera-navy);
  font-size: 12px;
  font-weight: 800;
}

.thera-topbar-product {
  margin-top: 2px;
}
```

Remove or stop using the old `.thera-nav-link` flat-menu visual treatment.

- [ ] **Step 4: Add responsive drawer CSS**

Add a desktop-hidden toggle and a mobile breakpoint. Use `900px` as the breakpoint so the content remains usable before the sidebar becomes too narrow:

```css
.thera-sidebar-toggle,
.thera-sidebar-backdrop {
  display: none;
}

@media (max-width: 900px) {
  .thera-app {
    grid-template-columns: minmax(0, 1fr);
  }

  .thera-sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    width: min(300px, 86vw);
    z-index: 60;
    transform: translateX(-102%);
    transition: transform 180ms ease;
  }

  .thera-sidebar.mobile-open {
    transform: translateX(0);
  }

  .thera-sidebar-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 36px;
    min-height: 36px;
    border: 1px solid var(--thera-border);
    border-radius: 8px;
    background: white;
    color: var(--thera-navy);
    cursor: pointer;
  }

  .thera-sidebar-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 50;
    border: 0;
    background: rgba(16,36,56,.42);
  }

  .thera-topbar {
    padding: 0 16px;
    gap: 12px;
  }

  .thera-content {
    padding: 20px 16px 40px;
  }
}
```

Use a simple `Menu` text/glyph in the toggle; do not add a dependency.

- [ ] **Step 5: Verify focus, responsive structure, typecheck, and build**

Run:

```bash
pnpm --filter @workspace/therassistant-inventory run typecheck:phase3
pnpm --filter @workspace/therassistant-inventory run build
```

Expected: PASS.

Then inspect `app-shell.tsx` source to confirm:

- workspace buttons use `aria-expanded`;
- active child links use `aria-current="page"`;
- mobile toggle has an accessible label;
- backdrop is a button and can be keyboard activated;
- top bar shows practice plus current workspace context;
- no Help Center dead link exists;
- no patient portal generic link exists.

- [ ] **Step 6: Commit Task 3**

```bash
git add artifacts/therassistant-inventory/src/components/app-shell.tsx \
  artifacts/therassistant-inventory/src/index.css
git commit -m "style: align navigation with Therassistant workspace hierarchy"
```

---

### Task 4: Run the full regression, smoke every workspace, and mark the spec verified

**Files:**
- Modify: `docs/superpowers/specs/2026-09-15-navigation-workspace-refactor-design.md`

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: evidence that the navigation change did not regress the Phase 2-5 workflows and that all representative deep links still resolve through the built SPA.

- [ ] **Step 1: Run the complete test suite**

From repository root:

```bash
pnpm --filter ./scripts exec tsx --test ../artifacts/therassistant-inventory/tests/**/*.test.ts
```

Expected: all existing and new tests PASS.

- [ ] **Step 2: Run the production TypeScript gate**

```bash
pnpm --filter @workspace/therassistant-inventory run typecheck:phase3
```

Expected: PASS. Do not substitute the broader legacy `typecheck` command for this production gate.

- [ ] **Step 3: Run the browser-secret scan**

```bash
if grep -R -n -E 'SUPABASE_SERVICE_ROLE_KEY|sb_secret_' artifacts/therassistant-inventory/src; then
  echo "Forbidden Supabase server secret marker found in browser source."
  exit 1
fi
```

Expected: no matches and exit code 0.

- [ ] **Step 4: Build the application**

```bash
pnpm --filter @workspace/therassistant-inventory run build
```

Expected: PASS. Existing nonblocking Vite chunk-size warnings may remain; no new build error is acceptable.

- [ ] **Step 5: Smoke representative routes from every workspace**

Run:

```bash
pnpm --filter @workspace/therassistant-inventory exec vite preview --config vite.config.ts --host 127.0.0.1 --port 4173 > /tmp/therassistant-navigation-preview.log 2>&1 &
PREVIEW_PID=$!
trap 'kill "$PREVIEW_PID" 2>/dev/null || true' EXIT

ready=0
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:4173/ >/dev/null; then
    ready=1
    break
  fi
  sleep 1
done

test "$ready" = "1" || { cat /tmp/therassistant-navigation-preview.log; exit 1; }

routes=(
  "/"
  "/work-center"
  "/clients"
  "/schedule"
  "/clinical"
  "/eligibility"
  "/authorizations"
  "/billing"
  "/billing/charges"
  "/claims"
  "/claims/submission"
  "/claims/follow-up"
  "/payments"
  "/ar-denials"
  "/providers"
  "/credentialing"
  "/payers-contracts"
  "/mailroom"
  "/reports"
  "/journal"
  "/administration/imports"
  "/administration"
  "/administration/database-inventory"
  "/mailroom/75000000-0000-4000-8000-000000000001"
)

for route in "${routes[@]}"; do
  code="$(curl -sS -o /tmp/therassistant-navigation-route.html -w '%{http_code}' "http://127.0.0.1:4173${route}")"
  test "$code" = "200" || { echo "$route returned $code"; exit 1; }
  grep -q '<div id="root"' /tmp/therassistant-navigation-route.html || { echo "$route missing SPA root"; exit 1; }
done
```

Expected: every route returns HTTP 200 and the SPA root.

- [ ] **Step 6: Confirm route definitions were not rewritten**

Inspect the final diff for `artifacts/therassistant-inventory/src/App.tsx`.

Expected: no change. If `App.tsx` changed, verify the change was strictly required for compatibility and does not implement the Phase 6 patient shell or rename routes.

- [ ] **Step 7: Mark the spec implemented only after all verification succeeds**

In `docs/superpowers/specs/2026-09-15-navigation-workspace-refactor-design.md`, change:

```text
Status: Approved design, pending implementation plan
```

to:

```text
Status: Implemented and verified
```

Do not make this status change if any test, typecheck, secret scan, build, or smoke route failed.

- [ ] **Step 8: Commit final verification status**

```bash
git add docs/superpowers/specs/2026-09-15-navigation-workspace-refactor-design.md
git commit -m "docs: mark workspace navigation refactor verified"
```

---

## Final Review Checklist

Before opening the pull request, verify all of the following from the final branch diff and test output:

- Sidebar has workspace groups, not the original flat 17-link list.
- Canonical workspace order is preserved in configuration.
- Help center exists in canonical metadata but is not a dead link.
- Workspace metadata includes safe primary destinations, icon/badge extension points, and future role visibility metadata without enforcing role logic in this refactor.
- Work Center is under Overview.
- Eligibility and Authorizations are under Care delivery.
- Claims, payments, and A/R are under Revenue cycle.
- Providers, Credentialing, Payers & Contracts, Mailroom, and Imports / Migration are under Operations.
- Reports is under Insights.
- Journal is under Client experience.
- Patient Portal route is recognized as Client experience context without becoming a generic staff link.
- Administration and Database Inventory are under Settings.
- `/administration/imports` is owned by Operations despite the URL prefix.
- Contextual record routes keep the correct workspace active.
- Only one workspace can be manually expanded at a time.
- Route changes automatically expand the owning workspace.
- Active child links use `aria-current="page"`.
- Workspace controls use semantic buttons with `aria-expanded`.
- Top bar shows practice context plus current workspace context.
- Mobile navigation can open and close without changing routes.
- Navy and sage remain the primary shell colors.
- No workflow/domain pages were broadly rewritten.
- No route was removed or renamed.
- Full tests pass.
- `typecheck:phase3` passes.
- Browser secret scan passes.
- Build passes.
- Representative route smoke checks pass.
