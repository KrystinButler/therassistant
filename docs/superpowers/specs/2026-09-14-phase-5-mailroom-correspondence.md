# Phase 5 — Mailroom & Correspondence Design

Date: 2026-09-14
Status: Approved design direction; implementation pending plan
Repository: `KrystinButler/therassistant`
Base: `main` at Phase 4 merge commit `f9d02b6d52b16a40420758f9b39a03e8ea1ec383`

## 1. Purpose

Phase 5 turns the existing Mailroom from a thin correspondence table into an operational correspondence work system.

The Mailroom must receive, classify, link, route, work, and close payer and administrative correspondence. It must connect each correspondence item to the operational record it affects, preserve document access, create follow-up work when action is required, and maintain auditable status history.

This phase follows the canonical Therassistant requirement that Mailroom is a correspondence work system rather than a passive document list.

## 2. Current State

The current `/mailroom` page is implemented inside `src/pages/operational-workspaces.tsx`.

It currently:

- reads `mailroom_items`, payers, claims, and clients;
- creates correspondence with subject, payer, optional claim, type, and notes;
- sets new items to `new`;
- permits `Start Work` by setting status to `in_progress`;
- permits `Resolve` by setting status to `resolved`;
- displays claim number and patient name when a claim is linked.

The current `mailroom_items` table contains:

- `id`
- `tenant_id`
- `payer_id`
- `claim_id`
- `subject`
- `correspondence_type`
- `received_date`
- `status`
- `notes`
- timestamps

The database already has a `documents` table with patient, claim, authorization, and appeal linkage plus document type, status, file name, storage path, MIME type, and file size.

The Work Center already supports reusable status, priority, assignment, due-date, and history behavior, but its enums do not yet contain a correspondence-specific workqueue type or a mailroom-item source-object type.

## 3. Goals

Phase 5 must provide:

1. an actionable Mailroom inbox;
2. a Correspondence 360 workspace for one item;
3. classification and operational linkage;
4. document linkage without creating a second attachment system;
5. due dates, ownership, and follow-up routing;
6. Work Center integration for correspondence requiring action;
7. auditable status changes;
8. human-readable context instead of UUID-driven screens;
9. deterministic synthetic demo scenarios and regression coverage.

## 4. Non-Goals

Phase 5 does not implement:

- OCR or AI document classification;
- inbound fax, email, or clearinghouse vendor integrations;
- automated payer portal scraping;
- production PHI storage controls beyond the existing demo architecture;
- a general enterprise document-management system;
- Reports, Imports, or Administration redesign;
- patient-facing document messaging.

Those remain separate phases or production-hardening work.

## 5. Considered Approaches

### Approach A — Expand the existing workflow spine

Reuse `mailroom_items`, `documents`, `workqueue_items`, and `status_history`. Add only the fields and enum values required for first-class correspondence workflow.

Advantages:

- preserves current data and routes;
- fits the Phase 1–4 architecture;
- avoids parallel task/document systems;
- keeps implementation reviewable;
- provides a clean production migration path.

This is the selected approach.

### Approach B — UI-only Mailroom enhancement

Keep the current schema and add filters, buttons, and detail screens only.

This is rejected because the current schema cannot represent provider linkage, ownership, due dates, review state, document relationship, or correspondence-specific Work Center source records reliably.

### Approach C — Replace Mailroom with a generalized document-management subsystem

Model all correspondence and documents through a new generalized entity/link framework.

This is rejected for Phase 5 because it adds unnecessary abstraction and migration risk. Therassistant already has usable first-class `mailroom_items` and `documents` tables.

## 6. Domain Model

### 6.1 Mailroom item

`mailroom_items` remains the source of truth for correspondence workflow.

The table should retain its existing fields and gain only the operational fields needed by the approved workflow:

- `client_id` nullable
- `provider_id` nullable
- `authorization_id` nullable
- `appeal_id` nullable
- `document_id` nullable
- `assigned_user_id` nullable
- `due_date` nullable
- `reviewed_at` nullable
- `closed_at` nullable

The existing `claim_id` and `payer_id` remain first-class links.

A correspondence item may link to more than one operational context where appropriate, for example a payer + patient + claim + appeal.

No generic JSON relationship field is introduced in this phase.

### 6.2 Correspondence type

The Mailroom must support at least the canonical categories:

- `eob`
- `denial_letter`
- `appeal`
- `reconsideration`
- `recoupment_notice`
- `refund_request`
- `credentialing_letter`
- `medical_record_request`
- `prior_authorization_notice`
- `payer_correspondence`

`general_correspondence` may be used as the fallback category.

Correspondence type remains a controlled application value in Phase 5. A database enum is not required unless implementation review shows a clear integrity benefit.

### 6.3 Status lifecycle

Mailroom status becomes an intentional workflow rather than arbitrary free-text updates.

Canonical Phase 5 states:

```text
new
reviewed
action_required
in_progress
pending
resolved
closed
```

Meaning:

- `new`: received and not yet reviewed;
- `reviewed`: classified and reviewed, no follow-up started yet;
- `action_required`: follow-up is required and must have an actionable work path;
- `in_progress`: active correspondence work is underway;
- `pending`: waiting on payer, provider, patient, records, or another dependency;
- `resolved`: required operational action is complete;
- `closed`: final administrative closure; no open correspondence work remains.

Status transitions must run through domain workflow actions rather than direct select/dropdown mutation.

### 6.4 Documents

The existing `documents` table remains the document/file source of truth.

Mailroom does not create another attachment table.

A Mailroom item references one primary `document_id` in Phase 5. Additional related documents can still be accessed through their normal patient, claim, authorization, or appeal relationships. Multiple arbitrary attachments per correspondence are deferred unless implementation proves the single-primary-document model insufficient for the existing demo requirements.

Document type values already supported by the database such as `eob`, `appeal_letter`, `authorization_letter`, and `payer_correspondence` should be reused where they match.

## 7. Mailroom Inbox

Route: `/mailroom`

The current page is replaced by a focused domain screen under `src/domains/mailroom/`.

The inbox must show human-readable columns:

- received date;
- subject;
- correspondence type;
- payer;
- patient;
- claim/control number where applicable;
- provider where applicable;
- due date;
- assignee;
- status;
- priority/action indicator.

The inbox must support:

- search by subject, patient, claim number, payer, and provider;
- status filter;
- correspondence-type filter;
- payer filter;
- assignment filter where user data is available;
- due/overdue filter;
- newest/oldest and due-date sorting;
- open item action to Correspondence 360;
- add correspondence action.

Raw UUIDs must not be displayed as primary identifiers.

## 8. Correspondence 360

Route: `/mailroom/:id`

Correspondence 360 is the operational workspace for one item.

It must show:

### Header

- subject;
- correspondence type;
- current status;
- received date;
- due date;
- payer;
- assignee/ownership;
- overdue indicator when applicable.

### Linked context

- patient with link to Patient Chart;
- claim with link to Claim 360;
- provider with link to Provider 360;
- authorization context when applicable;
- appeal context when applicable;
- payer with link to Payer 360.

### Document

- primary document file name;
- document type/status;
- open/download action when a valid stored document is linked;
- clear empty state when no document is attached.

### Work and history

- notes;
- related correspondence work item;
- status history;
- actions appropriate to the current state.

## 9. Workflow Actions

User actions call domain functions rather than directly changing status values.

Required actions:

```text
createCorrespondence()
classifyCorrespondence()
markCorrespondenceReviewed()
markCorrespondenceActionRequired()
startCorrespondenceWork()
pendCorrespondence()
resolveCorrespondence()
closeCorrespondence()
reopenCorrespondence()
linkCorrespondenceDocument()
```

Each action validates prerequisites and records history.

### Action-required behavior

When an item enters `action_required`, Therassistant must ensure there is an open correspondence Work Center item.

The Work Center record should contain:

- correspondence-specific workqueue type;
- source object type pointing to the Mailroom item;
- title derived from subject/type;
- payer/patient context through enrichment rather than raw IDs;
- due date when present;
- priority based on due-date urgency or explicit user selection.

Duplicate open work items for the same active correspondence should not be created by repeated transitions.

Resolving or closing the correspondence should complete its active correspondence work item when appropriate. Reopening correspondence should reopen or recreate actionable work according to existing Work Center history conventions.

## 10. Work Center Integration

Phase 5 adds:

- `correspondence` to `workqueue_type_enum`;
- `mailroom_item` to `workqueue_source_object_type_enum`.

Work Center source routing must deep-link correspondence work to `/mailroom/:id`.

The existing Work Center remains the exception/follow-up queue. It does not replace the Mailroom inbox.

## 11. Status History and Auditability

Every intentional Mailroom status transition writes `status_history` with:

- `target_type = 'mailroom_item'`;
- target Mailroom item ID;
- old status;
- new status;
- reason when supplied;
- timestamp;
- user identity when available in the existing demo architecture.

Work Center status changes continue to use the existing workqueue history model.

The Mailroom detail screen must expose correspondence status history in chronological order.

## 12. Data Access and Domain Boundaries

Phase 5 follows the architecture established in prior phases.

Target structure:

```text
src/domains/mailroom/
  MailroomPage.tsx
  CorrespondencePage.tsx
  workflow.ts
  repository.ts
  types.ts
```

The domain owns:

- Mailroom aggregate loading;
- human-readable enrichment;
- workflow transition rules;
- work-item synchronization;
- document linkage behavior;
- due-date state calculation.

`operational-workspaces.tsx` must stop owning the active Mailroom implementation once the new route is connected.

UI components do not perform arbitrary multi-table updates directly.

## 13. Due Dates and Priority

A correspondence item may have no due date.

When a due date exists:

- overdue items are visually distinct;
- items due within 7 calendar days are flagged as due soon;
- action-required Work Center items inherit the correspondence due date;
- overdue action-required work defaults to `urgent` priority;
- due-soon action-required work defaults to `high` priority;
- otherwise default priority is `normal` unless explicitly set through existing Work Center controls.

The due-date calculation is deterministic and testable with an injected current date.

## 14. Add Correspondence Workflow

The add correspondence form must support:

- subject;
- received date;
- correspondence type;
- payer;
- patient;
- claim;
- provider;
- authorization/appeal where relevant and available;
- due date;
- notes;
- optional link to an existing document.

Context selections must be constrained where reasonable. For example, when a patient is selected, the claim list should prefer that patient's claims rather than forcing users to identify relationships by UUID.

Creating a correspondence item does not automatically create a Work Center item unless the user marks it as requiring action or a workflow rule immediately classifies it as action required.

## 15. Synthetic Demo Scenarios

Phase 5 should provide deterministic synthetic examples that demonstrate distinct workflows without modifying real records.

Minimum scenarios:

1. new payer correspondence awaiting review;
2. medical-record request with a near due date and active correspondence work item;
3. recoupment/refund-related correspondence linked to a claim;
4. credentialing letter linked to a provider and payer;
5. resolved correspondence with completed work and visible history.

The scenarios must use synthetic data only.

## 16. Error Handling

The UI must display specific operational errors rather than fail silently.

Examples:

- linked correspondence not found;
- linked document missing;
- invalid status transition;
- attempt to close while required active work remains unresolved;
- failed Work Center synchronization;
- failed history write.

Where a transition affects the Mailroom item, history, and Work Center together, implementation should use a transactional database operation when partial success would leave inconsistent workflow state.

## 17. Security and RLS

All new or altered exposed tables must retain RLS.

Phase 5 must not introduce service-role credentials or privileged secrets into browser code.

Any database function used for atomic correspondence transitions must follow the same constrained security model used in prior phases:

- narrow purpose;
- explicit tenant/demo scope where applicable;
- least privilege;
- no broad anonymous destructive grants;
- post-migration security-advisor review.

## 18. Testing and Verification

Phase 5 requires dedicated tests for:

- allowed status transitions;
- invalid transition rejection;
- due-soon and overdue calculation;
- correspondence Work Center payload generation;
- duplicate work-item prevention;
- work-item completion/reopen behavior;
- history payloads;
- Mailroom aggregate enrichment;
- document linkage;
- synthetic scenario integrity;
- source routing to `/mailroom/:id`.

Regression verification must include the existing Phase 2, Phase 3, and Phase 4 CI gates.

The Phase 5 gate must run:

- automated tests;
- production TypeScript gate;
- browser-secret scan;
- Vite production build;
- SPA route smokes for `/mailroom` and a representative `/mailroom/:id` route.

A Vercel preview must be READY before merge review.

## 19. Schema Changes Expected

The implementation plan should expect one focused migration containing:

1. nullable operational link/ownership fields on `mailroom_items`;
2. supporting indexes for common Mailroom filters/links;
3. `correspondence` workqueue type;
4. `mailroom_item` workqueue source-object type;
5. any RLS/policy adjustments required for the synthetic demo's controlled Mailroom writes.

No schema change should be added solely for UI convenience.

## 20. Acceptance Criteria

Phase 5 is complete when:

- `/mailroom` is an actionable correspondence inbox;
- one correspondence item opens a dedicated Correspondence 360 route;
- correspondence can be classified and linked to relevant operational records;
- stored documents are reused and accessible from Correspondence 360;
- action-required correspondence creates one appropriate Work Center item;
- Work Center correspondence links return to the exact Mailroom item;
- status changes are intentional and auditable;
- due dates and overdue states are visible and tested;
- raw IDs are not normal user-facing identifiers;
- synthetic scenarios demonstrate the workflow;
- Phase 5 and regression CI pass;
- Vercel preview is READY with no Phase 5-specific blocking database advisor finding.
