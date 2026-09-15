# THERASSISTANT Work Drawer Architecture Design

## Goal

Refactor THERASSISTANT operational frontend workflows around one interaction rule: pages are persistent workspaces and permanent 360-degree records; right-side work drawers are where users perform operational work. Preserve current routes, business logic, state machines, API behavior, and permanent detail pages.

## Interaction architecture

Workspace pages remain mounted while a selected operational record is opened in a reusable `WorkDrawer`. The drawer is presentation and orchestration infrastructure only; it must not duplicate domain/business logic. Existing forms, mutations, API calls, repositories, validation logic, and workflow transitions remain authoritative and should be reused or extracted into focused domain components where necessary.

A drawer closes back to the exact workspace state that was visible before opening. Search, filters, selected tab, sorting, pagination, workqueue membership/order, and scroll position remain unchanged. Previous, Next, and Save & Continue operate against the currently displayed filtered/sorted queue rather than an independently fetched generic list.

Permanent detail routes remain available for deep review, history, reporting, direct linking, and full-record work. Operational drawers include an `Open Full Record` or module-specific `Open 360` action when such a route exists.

## Reusable WorkDrawer

Build `WorkDrawer` using the existing Sheet/right-side panel primitive already present in the project. Before implementation, identify the actual primitive in the repository; do not add another UI library.

The public API supports `open`, `onOpenChange`, `title`, `subtitle`, `badges`, `children`, `footer`, `onPrevious`, `onNext`, `openFullRecord`, and optional queue position text such as `3 of 17`.

Desktop behavior: right-side drawer, approximately 700-850px wide on large screens, using most available vertical height. Small-screen behavior: full-width or nearly full-width. Header and footer remain sticky while the body scrolls. The workspace stays visible behind the drawer where screen width permits.

The shell is keyboard accessible and responsive. Dirty forms intercept close attempts and require confirmation before discarding unsaved changes. Destructive actions are visually separated from primary save actions.

## Claims

Claims are the first and highest-priority consumer. Clicking a row in `/claims` selects that claim in workspace state and opens `ClaimWorkDrawer` without navigating away.

The header displays human-readable operational context: patient, claim/control number, payer, rendering provider, DOS, charge amount, claim status, and clearinghouse/rejection/denial status when applicable. UUIDs and internal IDs are not shown when a human-readable identifier exists.

The drawer organizes complex content into focused sections/tabs: Claim Fields, Claim Lines, Diagnoses, Validation Errors, Clearinghouse Responses, Rejections, Denials, Appeals, Work Items, and Notes / History.

Claim editing reuses existing claim update and validation business logic. Pre-submission validation failures remain validation failures and are never labeled `Action Required`. `Action Required` is reserved for post-submission clearinghouse/payer rejection responses.

Each actionable validation/rejection item teaches the user four things: what is wrong, why it matters, what must be corrected, and the direct correction action. A field-target registry maps correction actions to an editable control. For example, `Correct Taxonomy` activates Claim Fields and focuses/scrolls the rendering-provider taxonomy field. This targeting mechanism should use stable semantic field keys rather than DOM implementation details.

Claim actions include, when valid for the record state: Save, Save & Revalidate, Retry Rejected Claim, Create Follow-Up, Create Appeal, Save & Continue, Previous, Next, and Open Full Claim 360.

## Queue state and navigation

Drawer queue navigation consumes the ordered records already represented by the workspace after current filtering, searching, sorting, and pagination. Opening, closing, or changing the selected record must not reconstruct the workspace state.

`Save & Continue` saves successfully first, then advances to the next eligible record in the current queue. If no next record exists, the drawer remains on the saved record and communicates that the queue position is complete. Failed saves do not advance.

## A/R and denials

Structured drawers replace browser prompts and fragmented operational actions for Work Denial, Create Appeal, Record Appeal Outcome, Underpayment Review, Recoupment Review, Refund Review, and Follow-Up Activity.

The denial work surface displays patient, claim, payer, DOS, denied amount, CARC, RARC, category, reason, timely-filing/appeal deadline, workability, existing activity, and related claim information. Appeal creation/outcome uses normal form controls for status, dates, structured choices, and notes. Remove `window.prompt()` from these workflows.

## Payments

The Payments route becomes primarily a workspace/workqueue. `+ Post Payment` opens a work drawer for insurance payment, patient payment, claim allocation, unapplied payment, trace/check numbers, payment method, and notes.

Selecting an existing payment opens Payment Detail with source, amount, allocated/unapplied amounts, patient, payer, claim allocations, ERA/835 information, adjustment/reversal history, and notes. Payment reversal uses a structured drawer/form requiring a reason instead of a browser prompt.

## Patient, provider, schedule, and credentialing conversions

Convert Add/Edit Patient and Add/Edit Provider centered modals to `WorkDrawer` while preserving their existing fields/save behavior and permanent detail routes.

Convert New/Edit Appointment to the drawer architecture while preserving schedule context. Display patient/provider names rather than internal IDs.

Convert Edit Enrollment to a drawer supporting effective date, revalidation due date, termination date, payer provider ID, notes, and existing credentialing workflow actions where they can be safely reused without leaving the workspace.

## Mailroom

Mailroom correspondence ultimately opens in a work drawer while the inbox remains mounted. The drawer supports correspondence viewing, classification, linking to patient/claim/payer/provider, work-item creation, notes, completion, and moving to the next correspondence item. Keep the permanent correspondence route.

## State ownership

Workspace components own queue/list state and selected-record identity. Domain forms own editable form state and dirty state. `WorkDrawer` owns only drawer mechanics and generic navigation/action presentation. Domain services/hooks continue to own persistence and workflow rules.

Avoid URL transitions for ordinary operational selection. Do not introduce a parallel state machine inside drawers.

## Accessibility and responsive behavior

Use the accessibility semantics and focus trapping supplied by the project's existing Sheet/dialog primitive. On open, focus an appropriate drawer heading or first task control. On close, restore focus to the triggering row/action when possible. Field-target correction actions move focus to the requested editable field. Keyboard users can reach header actions, tabs/sections, body controls, and footer actions.

## Implementation sequence

1. Reusable WorkDrawer shell.
2. Claim Work Drawer.
3. Claim field editing and error-to-field navigation.
4. Save & Continue and Previous/Next queue navigation.
5. A/R denial and appeal drawers.
6. Payment entry and payment detail drawers.
7. Patient, Provider, Schedule, and Credentialing conversions.
8. Mailroom drawer workflow.

Each phase must run TypeScript/typecheck, production build, relevant tests, route smoke verification, drawer open/close checks, queue/filter state persistence checks, keyboard/dirty-state checks where affected, and responsive verification. Regressions are fixed before continuing.

## Non-goals and constraints

Do not remove workspace or 360 routes. Do not replace repositories, API calls, database logic, workflow state machines, or business rules merely to support the drawer interaction. Do not add another UI library. Do not expose UUIDs/internal IDs when readable values are available. Do not create giant unsectioned forms. Preserve existing THERASSISTANT styling, status badges, form controls, colors, and buttons.
