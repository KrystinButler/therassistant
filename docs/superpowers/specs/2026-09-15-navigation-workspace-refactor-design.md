# THERASSISTANT Workspace Navigation Refactor

Date: 2026-09-15
Status: Approved design, pending implementation plan
Branch: `navigation-workspace-refactor`

## Purpose

Refactor the Vercel navigation so the ChatGPT Therassistant site is the canonical information architecture.

The current Vercel build has developed many individual workflows well, but those workflows were promoted directly into the main sidebar. This produces a flat menu of operational pages instead of the workspace hierarchy defined by the Therassistant product model.

This refactor preserves the existing workflow pages, routes, and domain logic. It changes how users discover and move between them.

## Canonical source of truth

The canonical top-level workspace structure is the Therassistant ChatGPT site:

1. Overview
2. Care delivery
3. Revenue cycle
4. Operations
5. Insights
6. Client experience
7. Help center
8. Settings

The implementation must follow this hierarchy even when existing Vercel route names differ.

The product rule is:

> Simple workspace groups first, then focused workqueues and workflows inside each group.

Workqueues and status-specific views remain inside the workspace that owns the work. They are not promoted to peer-level global navigation merely because they have their own route.

## Goals

- Make the Vercel information architecture match the ChatGPT Therassistant site.
- Preserve the strong workflows already implemented.
- Reduce sidebar clutter and duplicate mental models.
- Keep common work reachable within one or two interactions.
- Keep the active workspace visible while the user works inside a nested route.
- Support role-aware navigation later without another structural redesign.
- Preserve all current deep links so bookmarks, demo scenarios, and contextual links continue to work.
- Maintain the Therassistant navy-and-sage visual system.

## Non-goals

This project does not redesign every workflow page.

It does not rename database tables, rewrite domain logic, replace existing repositories, or move business logic between modules.

It does not build production role-based access control.

It does not create placeholder pages solely to fill the navigation.

It does not create a Help Center route until Help Center content exists.

It does not merge unrelated workflows into one code file simply because they share a workspace group.

It does not implement the separate patient-facing shell or the broader Phase 6 Patient Portal redesign. Those remain a separate approved project.

## Current problem

The current `AppShell` exposes a long flat list of peer navigation items:

- Home
- Work Center
- Clients
- Schedule
- Clinical
- Eligibility
- Authorizations
- Billing
- Claims
- Payments
- A/R & Denials
- Providers
- Credentialing
- Payers & Contracts
- Mailroom
- Reports
- Administration

This treats workflows, workqueues, domain roots, and administration as the same navigation level.

The routes themselves are useful and should remain. The problem is promotion, not existence.

## Target information architecture

### Overview

Purpose: Show what needs attention across the practice and connect the care-to-payment workflow.

Primary destinations:

- Home: `/`
- Work Center: `/work-center`

Overview owns the care-to-payment summary:

- Prepare
- Document
- Capture
- Submit
- Reconcile

These stages may deep-link into the owning workspace, but they are not additional global sidebar items.

### Care delivery

Purpose: Manage patient readiness and delivery of care before and during the encounter.

Primary destinations:

- Patients: `/clients`
- Schedule: `/schedule`
- Clinical: `/clinical`
- Eligibility & Benefits: `/eligibility`
- Authorizations: `/authorizations`

Contextual routes that remain under this workspace but do not become sidebar items:

- Patient chart: `/clients/:id`
- Pre-Session: `/schedule/:id`
- Encounter: `/encounters/:id`
- Golden Thread: `/clinical/golden-thread/:clientId`
- Medicaid-specific workflow: `/medicaid`

Patient insurance, eligibility, authorizations, documents, and related readiness information should also remain reachable contextually from the patient chart.

### Revenue cycle

Purpose: Move documented services through charge capture, claim submission, payment, and revenue recovery.

Primary destinations:

- Billing Overview: `/billing`
- Charge Capture: `/billing/charges` and existing alias `/charges`
- Claims: `/claims`
- Claim Submission / 837P: `/claims/submission`
- Claim Follow-Up: `/claims/follow-up`
- Payments: `/payments`
- A/R & Denials: `/ar-denials`

Contextual routes:

- Claim 360: `/claims/:id`

Detailed rejections, appeals, ERA/payment posting, recoupments, underpayments, and follow-up queues remain inside the appropriate revenue-cycle workspace rather than becoming global navigation items.

### Operations

Purpose: Manage payer relationships, provider participation, incoming correspondence, and operational data movement.

Primary destinations:

- Providers: `/providers`
- Credentialing: `/credentialing`
- Payers & Contracts: `/payers-contracts`
- Mailroom: `/mailroom`
- Imports / Migration: `/administration/imports`

Contextual routes:

- Provider detail: `/providers/:id`
- Payer detail: `/payers/:id`
- Correspondence 360: `/mailroom/:id`

The Imports route remains technically under `/administration/imports` for backward compatibility, but navigation presents it under Operations because that is where the work belongs conceptually.

### Insights

Purpose: Show operational, financial, payer, clinical-readiness, and productivity reporting.

Primary destination:

- Reports: `/reports`

Future dashboards and saved reporting views belong here rather than as additional global navigation items.

### Client experience

Purpose: Organize the patient-facing side of Therassistant from the staff application's information architecture.

Visible staff destination in this refactor:

- Journal: `/journal`

Contextual routes owned by Client experience but not rendered as ordinary global child links:

- Patient Portal: `/patient-portal/:clientId`
- appointment/patient Check-In workflow
- patient financial/account actions

Because Patient Portal requires patient context, the navigation must not link to an invalid generic portal route. Patient-specific portal access remains contextual from patient records and demo scenarios.

The separate patient-facing shell remains Phase 6 scope and is not implemented by this navigation refactor.

### Settings

Purpose: Configure the practice and platform.

Primary destinations:

- Administration: `/administration`
- Database Inventory: `/administration/database-inventory`

Administration remains the root for practice configuration, users, security, payer configuration, EDI/clearinghouse settings, portal settings, integrations, and audit configuration as those features are implemented.

### Help center

Help Center remains part of the canonical information architecture but is not rendered as a clickable destination until a real Help Center route exists.

Do not add a dead link or placeholder page just to make the menu visually complete.

## Navigation interaction model

### Workspace-first accordion

The staff sidebar displays the workspace groups rather than every route.

Behavior:

- Overview is a workspace group containing Home and Work Center.
- Care delivery, Revenue cycle, Operations, Insights, Client experience, and Settings are workspace groups.
- Only one major workspace is expanded at a time.
- The group containing the current route automatically opens.
- The active child route is highlighted.
- Navigating to a contextual route keeps its owning workspace highlighted.
- Collapsing and expanding the sidebar does not alter the current route.
- On smaller screens, the navigation becomes an overlay/drawer rather than consuming permanent content width.

### Route ownership

Route ownership must be defined in one centralized navigation configuration rather than duplicated in JSX conditionals.

Each navigation entry should define:

- stable workspace id
- workspace label
- optional icon
- primary route when a safe generic route exists
- child routes
- route match rules for contextual descendants
- visibility metadata for future role-aware behavior
- optional badge/count source

The route ownership configuration should be usable by the sidebar, breadcrumbs, command/search navigation, and future role filtering.

### Route compatibility

Existing routes remain valid.

This refactor must not force a route rename merely to mirror a workspace label.

Examples:

- `/clients` remains valid even though the UI label is Patients.
- `/ar-denials` remains valid under Revenue cycle.
- `/administration/imports` remains valid even though the navigation entry is under Operations.
- `/billing/charges` remains the preferred charge route while `/charges` remains compatible if currently referenced.

## Top bar

The top bar should support the workspace hierarchy instead of repeating it.

Required structure:

- Therassistant/practice context
- breadcrumb or current workspace context
- global search / command entry when implemented
- Create action when implemented
- notifications/status area when implemented
- user/practice identity area

Do not fill the top bar with another copy of the sidebar.

## Visual design

The refactor uses the Therassistant visual system established for the ChatGPT site.

Core palette:

- deep navy for the shell, primary text, major navigation, and active structural states
- sage green for selected/completed/supporting states and restrained accents
- white/off-white content backgrounds
- subdued neutral borders and secondary text

Navigation should feel like software, not a marketing page.

Use clear hierarchy, compact spacing, readable labels, restrained badges, and predictable active states.

Avoid introducing unrelated accent colors or decorative navigation treatments.

## Page-level navigation

A workspace can contain multiple workflows without putting all of them permanently in the global sidebar.

Use page-level tabs, queue selectors, cards, and contextual links where appropriate.

Examples:

- Claims owns Submission, Follow-Up, rejected/action-required work, and claim search.
- Clinical owns documentation, treatment plans, Golden Thread, and encounter-related work.
- Credentialing owns provider enrollment, participation, rosters, affiliations, and credentialing issues.
- Patient Chart owns demographics, insurance, eligibility, authorizations, claims, balances, documents, and other patient-specific context.

The sidebar answers, "What kind of work am I doing?"

The workspace answers, "Which workflow within that work do I need?"

The workqueue answers, "What specifically needs attention?"

## Work Center relationship

Work Center stays under Overview because it is cross-workspace.

A Work Center item deep-links directly to the owning record or workflow while preserving the owning workspace highlight.

Examples:

- eligibility issue -> Care delivery
- unsigned clinical note -> Care delivery
- rejected claim -> Revenue cycle
- correspondence item -> Operations
- credentialing task -> Operations

Work Center must not become a second navigation system.

## Client Experience separation

The staff-side Client experience workspace and the patient-facing portal are related but not the same shell.

This navigation refactor only establishes correct route ownership and prevents the patient portal from being promoted as a generic staff navigation link.

A dedicated patient-facing shell with Therassistant branding, navy-and-sage styling, and no staff operational navigation is part of the separate Phase 6 Patient Portal project.

## Error and fallback behavior

- A current route that is not explicitly mapped still renders; navigation falls back to the closest known parent or no active child rather than crashing.
- Deep links continue to load directly.
- Missing badge/count data never blocks navigation rendering.
- If a workspace has no safe generic child destination, do not fabricate one.
- Navigation state is derived from the current URL so browser back/forward navigation stays correct.

## Accessibility

- Workspace controls use semantic buttons when they expand/collapse rather than pretending to be links.
- `aria-expanded` is present on accordion controls.
- Active links expose current-page state.
- Keyboard users can expand a workspace and reach each visible child.
- Focus treatment must remain visible against navy and white backgrounds.
- Collapsed/mobile navigation must remain keyboard dismissible.

## Files expected to change

Likely implementation surface:

- `artifacts/therassistant-inventory/src/components/app-shell.tsx`
- new centralized navigation configuration under `src/components` or `src/navigation`
- navigation-specific styles in the existing application stylesheet(s)
- focused navigation tests
- `src/App.tsx` only if navigation-safe route metadata or route-shell plumbing is needed without implementing the patient-shell redesign

Existing domain pages should not require broad rewrites for this navigation refactor.

## Testing requirements

Add deterministic tests for:

1. Canonical top-level workspace order.
2. Current route -> owning workspace mapping.
3. Contextual route ownership for patient, claim, provider, payer, Mailroom, encounter, Pre-Session, Golden Thread, and Patient Portal routes.
4. Only one expanded workspace at a time.
5. Existing deep links remain valid.
6. `/administration/imports` appears under Operations while remaining route-compatible.
7. Work Center remains under Overview.
8. Patient-specific portal routes do not become ordinary staff global links.
9. No raw UUIDs or route fragments appear as navigation labels.
10. Existing Phase 2-5 domain tests remain green.
11. Production typecheck gate remains `typecheck:phase3` unless a separate approved project changes it.
12. Build succeeds.
13. Vite route smoke tests cover representative destinations from each workspace.

## Representative smoke routes

- `/`
- `/work-center`
- `/clients`
- `/schedule`
- `/clinical`
- `/eligibility`
- `/authorizations`
- `/billing`
- `/billing/charges`
- `/claims`
- `/claims/submission`
- `/claims/follow-up`
- `/payments`
- `/ar-denials`
- `/providers`
- `/credentialing`
- `/payers-contracts`
- `/mailroom`
- `/reports`
- `/journal`
- `/administration/imports`
- `/administration`

## Acceptance criteria

The refactor is complete when:

- the Vercel sidebar visually and structurally uses the canonical ChatGPT Therassistant workspace groups;
- current routes are preserved;
- existing workflow pages are nested under the appropriate workspace rather than promoted globally;
- the active workspace is derived correctly for direct and contextual routes;
- one workspace is expanded at a time;
- the interface retains the Therassistant navy-and-sage design language;
- Help Center is not a dead link;
- patient-facing routes are not presented as ordinary staff navigation;
- existing tests, `typecheck:phase3`, build, security checks, and route smoke tests pass;
- no unrelated domain behavior is changed.

## Implementation principle

Preserve the work. Fix the hierarchy.

The Vercel application already contains useful operational workflows. This project places those workflows back under the Therassistant workspace structure instead of replacing them.
