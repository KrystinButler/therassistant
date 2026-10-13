# THERASSISTANT EHR Workflow-Centered UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect portal check-in, screeners, telehealth, clinical documentation, signing, charge capture, and claims into one verifiable workflow while redesigning the EHR UI around dense operational workspaces.

**Architecture:** Fix the data/workflow contracts before visual restructuring. Patient-reported pre-visit data is normalized once and reused by schedule review and encounter context; telehealth room creation is handled server-side through Daily and persisted to the appointment; staff and portal UIs consume the same appointment/check-in state. After the workflow backbone is proven, consolidate the shell, patient workspace, clinical workspace, and RCM pages around shared UI primitives without replacing working repositories.

**Tech Stack:** React 18, TypeScript, Vite, Wouter, Express, Drizzle/PostgreSQL/Supabase, pnpm 10.28.0, Playwright, Daily embedded video.

**Spec:** `docs/superpowers/specs/2026-10-12-ehr-ui-workflow-redesign-spec.md`

## Global Constraints

- Do not call a feature fixed because the component renders; verify the underlying workflow/data movement.
- Preserve tenant scoping and existing RLS/auth boundaries.
- PHQ-9, GAD-7, and C-SSRS remain patient-authored source data with provenance.
- Daily production use is disabled unless required HIPAA/BAA configuration is present.
- Do not include patient names, DOBs, email addresses, or other PHI in Daily room names.
- Save Draft and Sign & Lock remain separate operations.
- Signed/locked clinical text is immutable; downstream billing corrections do not rewrite the signed note.
- Reuse existing repositories and workflow services; do not build parallel data stores.
- Full-width workflow screens should use available width and avoid decorative whitespace.

## Review Focus

1. **Incomplete/declined screeners:** declined screeners remain visibly deferred rather than producing fake zero scores; partially completed screeners cannot appear as complete.
2. **Telehealth unavailable:** missing Daily configuration, room creation errors, or expired rooms must produce an explicit unavailable/retry state without exposing secrets or silently using an unsafe fallback.
3. **Repeated check-in submission:** submitting the same check-in twice must not create multiple telehealth rooms or duplicate patient-authored note imports.
4. **Unsaved clinical edits:** Sign & Lock must reject any draft whose current fingerprint differs from the last persisted fingerprint.
5. **Signed-note billing corrections:** charge/claim fixes must modify billing source fields or downstream billing records while the signed clinical note remains unchanged.

---

### Task 1: Establish workflow regression tests

**Files:**
- Create: `tests/workflow/portal-screeners.test.ts`
- Create: `tests/workflow/patient-review-model.test.ts`
- Create: `tests/workflow/clinical-source-context.test.ts`
- Create: `tests/workflow/telehealth-room-policy.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing pure workflow functions in `portal-screeners.ts`, `patient-review-model.ts`, and `clinical-source-context.ts`.
- Produces: `pnpm test:workflow` as the fast regression command used by later tasks.

- [ ] **Step 1: Add `test:workflow` to the root scripts**

Set it to run `node --experimental-strip-types --test tests/workflow/*.test.ts`.

- [ ] **Step 2: Write failing screener contract tests**

Cover: complete PHQ-9/GAD-7 totals, conditional C-SSRS completeness, declined screeners, partial screeners, and no fabricated score for incomplete answers.

- [ ] **Step 3: Write failing pre-visit review/import tests**

Assert that submitted screeners are represented in the clinician-facing review model, that unsubmitted drafts are excluded, and that patient-authored imports are labeled with portal provenance.

- [ ] **Step 4: Write failing telehealth room policy tests**

Assert random/non-PHI room names, appointment-bounded expiration, idempotent reuse of an existing active room, and explicit failure when provider configuration is absent.

- [ ] **Step 5: Run tests and capture expected failures**

Run: `pnpm test:workflow`
Expected: FAIL only on the new behavior not yet implemented.

- [ ] **Step 6: Commit**

`git commit -am "test: pin EHR workflow redesign contracts"`

---

### Task 2: Carry full portal screener state into the clinician workflow

**Files:**
- Modify: `artifacts/therassistant-inventory/src/domains/portal/portal-screeners.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/scheduling/patient-review-model.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/encounters/clinical-source-context.ts`
- Create: `artifacts/therassistant-inventory/src/domains/clinical/PreVisitScreenersPanel.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/scheduling/PatientReviewDrawer.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/encounters/EncounterPage.tsx`
- Test: `tests/workflow/portal-screeners.test.ts`
- Test: `tests/workflow/patient-review-model.test.ts`
- Test: `tests/workflow/clinical-source-context.test.ts`

**Interfaces:**
- Produces: `ScreenerSummary`, `summarizeScreeners(answers)`, and `PatientReviewCheckIn.screeners` for all clinician surfaces.
- Produces: a reusable `PreVisitScreenersPanel` that accepts the normalized summary and submitted timestamp/source metadata.

- [ ] **Step 1: Implement `ScreenerSummary` and `summarizeScreeners`**

Expose PHQ-9 total, GAD-7 total, C-SSRS submitted/positive-response metadata, completeness, and declined state. Never infer a clinician risk classification from patient answers.

- [ ] **Step 2: Extend `buildPatientReviewCheckIn`**

Return the normalized screener summary only when `pre_visit.submitted_at` exists. Preserve the existing focus/mood/changes/safety fields.

- [ ] **Step 3: Extend `buildPreVisitNoteInsert`**

Include patient-reported PHQ-9/GAD-7 totals and a C-SSRS questionnaire-submitted statement when available. Label the block as patient-reported portal information and do not convert responses into diagnoses/risk ratings.

- [ ] **Step 4: Render screeners in `PatientReviewDrawer`**

Replace the current “review questionnaire answers in the clinical note workspace” placeholder with actual score/submission information and a clinician-review-required state.

- [ ] **Step 5: Render `PreVisitScreenersPanel` in `EncounterPage`**

Place it in the clinical context column next to other pre-visit information. Keep “Import Answers into Note” idempotent through the existing provenance mechanism.

- [ ] **Step 6: Run regression tests and typecheck**

Run: `pnpm test:workflow && pnpm --filter @workspace/therassistant-inventory run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

`git commit -am "feat: connect portal screeners to clinical review"`

---

### Task 3: Add server-side Daily telehealth room orchestration

**Files:**
- Create: `supabase/migrations/202610120001_add_telehealth_session_fields.sql`
- Modify: `lib/db/src/schema/clinical.ts`
- Create: `artifacts/api-server/src/lib/daily.ts`
- Create: `artifacts/api-server/src/routes/telehealth.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Test: `tests/workflow/telehealth-room-policy.test.ts`

**Interfaces:**
- Environment: `DAILY_API_KEY`, `DAILY_DOMAIN`, `DAILY_HIPAA_ENABLED=true`.
- Produces endpoint: `POST /api/telehealth/appointments/:appointmentId/session`.
- Produces appointment fields: `telehealth_provider`, `telehealth_room_name`, `telehealth_url`, `telehealth_room_expires_at`.

- [ ] **Step 1: Add appointment telehealth session columns**

Migration adds nullable text/timestamp fields listed above. Do not store API keys or meeting tokens in appointment rows.

- [ ] **Step 2: Update Drizzle appointment schema**

Add camelCase mappings for the new columns so API code can use typed appointment rows.

- [ ] **Step 3: Implement room-name and expiration policy helpers in `daily.ts`**

Create a cryptographically random room name with no patient/appointment display data. Expiration should be based on appointment end time plus a short grace period; tests pin the exact rule.

- [ ] **Step 4: Implement Daily room creation**

Call Daily only from the server using `DAILY_API_KEY`. Refuse creation unless `DAILY_HIPAA_ENABLED` is exactly `true`. Use private rooms and the account/domain configuration required for embedded healthcare use.

- [ ] **Step 5: Implement idempotent appointment session endpoint**

Require authenticated tenant context. Allow practice/platform admins and the clinician assigned to the appointment. Verify appointment belongs to tenant and is telehealth. Reuse a non-expired existing Daily room; otherwise create and persist a new room.

- [ ] **Step 6: Register the telehealth router**

Add `router.use(telehealthRouter)` in `artifacts/api-server/src/routes/index.ts`.

- [ ] **Step 7: Run tests/typecheck**

Run: `pnpm test:workflow && pnpm --filter @workspace/api-server run typecheck && pnpm run typecheck:libs`
Expected: PASS.

- [ ] **Step 8: Commit**

`git commit -am "feat: orchestrate HIPAA-gated telehealth rooms"`

---

### Task 4: Replace pasted video links with one connected visit experience

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/scheduling/telehealth-api.ts`
- Modify: `artifacts/therassistant-inventory/src/domains/scheduling/TelehealthVisit.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/portal/PatientCheckInPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/portal/PatientPortalPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/scheduling/PatientReviewDrawer.tsx`
- Create: `e2e/portal-telehealth-handoff.spec.ts`

**Interfaces:**
- Consumes: `POST /api/telehealth/appointments/:appointmentId/session`.
- Produces: common visit states `not_required | not_configured | preparing | ready | unavailable | ended` and one join action used by staff and patient surfaces.

- [ ] **Step 1: Add typed telehealth API client**

Implement `ensureTelehealthSession(appointmentId)` and normalize server errors into the visit states above.

- [ ] **Step 2: Refactor `TelehealthVisit`**

Remove staff-facing manual URL editing from the normal workflow. Render session readiness and embedded/join experience from the server-provisioned Daily URL. Keep a clear configuration error when HIPAA/provider setup is absent.

- [ ] **Step 3: Wire check-in submission to telehealth session creation**

After successful pre-visit submit, ensure the session, then transition into the visit experience. Do not navigate before the check-in persistence succeeds. Re-submission must reuse the active room.

- [ ] **Step 4: Show the same telehealth readiness in schedule review and portal home**

Staff must see whether the room is ready before starting the encounter; patients must see check-in required vs ready-to-join states.

- [ ] **Step 5: Add E2E coverage**

Mock Daily/server boundary if production credentials are unavailable in CI. Verify submit → room ready → visit displayed, and verify missing HIPAA configuration produces an explicit unavailable state.

- [ ] **Step 6: Run checks**

Run: `pnpm test:workflow && pnpm run typecheck && pnpm exec playwright test e2e/portal-telehealth-handoff.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

`git commit -am "feat: connect check-in to telehealth visit"`

---

### Task 5: Redesign the shell, schedule, patient chart, and clinical queue for workflow density

**Files:**
- Modify: `artifacts/therassistant-inventory/src/components/app-shell.tsx`
- Modify: existing global/reference theme CSS under `artifacts/therassistant-inventory/src`
- Modify: `artifacts/therassistant-inventory/src/domains/scheduling/SchedulePage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/scheduling/patient-review-drawer.css`
- Modify: `artifacts/therassistant-inventory/src/domains/patients/PatientChartPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/clinical/ClinicalPage.tsx`
- Create/Consolidate: shared workflow primitives in `artifacts/therassistant-inventory/src/components/`

**Interfaces:**
- Produces shared `PageHeader`, `PatientBanner`, `MetricStrip`, `ActionBar`, `WorkList`, `ExceptionCard`, and `Stepper` where the current component set does not already cover the need.

- [ ] **Step 1: Reorganize staff navigation**

Implement the approved Home / Revenue Cycle / Practice / Administration grouping while preserving current routes and redirects.

- [ ] **Step 2: Add width/density rules**

Make schedule, patient chart, encounter, billing tables, and claims use the available content width. Keep settings/forms constrained.

- [ ] **Step 3: Make Schedule the entry point to the care workflow**

Preserve existing day/week/month/filtering/drawers. Make appointment readiness, pre-visit state, telehealth readiness, Open Chart, and Start/Resume Note prominent.

- [ ] **Step 4: Add persistent patient banner and simplify patient tabs**

Tabs become Overview, Clinical, Visits, Insurance, Billing, Documents, Portal. Move demographic editing into a focused edit action/drawer without deleting data access.

- [ ] **Step 5: Reformat Clinical Notes as a work queue**

Needs Note and In Progress use action-oriented work items; Signed and All retain history-table density.

- [ ] **Step 6: Run typecheck and relevant provider E2E tests**

Run: `pnpm run typecheck && pnpm exec playwright test e2e/provider-clinical-flow.spec.ts e2e/provider-insured-clinical-flow.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

`git commit -am "feat: redesign core EHR workspaces"`

---

### Task 6: Redesign the encounter as a persistent clinical workspace

**Files:**
- Modify: `artifacts/therassistant-inventory/src/domains/encounters/EncounterPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/encounters/encounter-page.css`
- Reuse: `artifacts/therassistant-inventory/src/domains/clinical/PreVisitScreenersPanel.tsx`
- Create: `e2e/clinical-save-sign-state.spec.ts`

**Interfaces:**
- Consumes: existing `saveClinicalNote`, `signEncounterNote`, source-import provenance, treatment-plan context, coding/service-line repositories.
- Produces: explicit UI state `unsaved → saving → saved → signed/locked` without changing existing persistence semantics.

- [ ] **Step 1: Convert encounter to main/context columns**

Main column holds note workflow; context column holds pre-visit/screeners, prior visit, treatment plan, journal, and documents.

- [ ] **Step 2: Add persistent save/sign status bar**

Show Unsaved Changes, Save Draft, Saved, and Sign & Lock states based on the current note fingerprint and signed status.

- [ ] **Step 3: Keep Sign & Lock strict**

The action must reject unsaved edits, missing saved note ID, missing rendering/signing requirements, and already-signed state as applicable.

- [ ] **Step 4: Collapse clinician coding into Visit Coding**

Keep essential CPT/POS/modifier/diagnosis visibility, but move detailed billing corrections out of the primary note-writing path.

- [ ] **Step 5: Add E2E save/sign tests**

Verify Sign & Lock cannot silently save; save then sign works; post-sign note controls are locked while billing correction links remain available downstream.

- [ ] **Step 6: Run checks**

Run: `pnpm run typecheck && pnpm exec playwright test e2e/clinical-save-sign-state.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

`git commit -am "feat: redesign clinical documentation workspace"`

---

### Task 7: Simplify patient portal around appointment readiness

**Files:**
- Modify: `artifacts/therassistant-inventory/src/domains/portal/PatientPortalPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/portal/PatientCheckInPage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/portal/patient-portal-redesign.css`
- Modify: `artifacts/therassistant-inventory/src/domains/portal/patient-checkin.css`
- Test: `e2e/portal-telehealth-handoff.spec.ts`

**Interfaces:**
- Consumes: the same check-in/telehealth state introduced in Tasks 2–4.

- [ ] **Step 1: Make next appointment the portal home priority**

Show appointment time, check-in progress, telehealth state, and the single correct next action.

- [ ] **Step 2: Reduce secondary portal actions to clear destinations**

Appointments, Messages, Documents, Billing, Insurance, Journal remain available without competing with the upcoming-visit flow.

- [ ] **Step 3: Preserve five-step check-in**

Demographics → Insurance → Visit Questions/Screeners → Consents → Review & Submit. Do not re-ask submitted/read-only information.

- [ ] **Step 4: Verify mobile and keyboard behavior**

Ensure stepper, controls, screeners, and telehealth entry remain usable at narrow widths and with keyboard navigation.

- [ ] **Step 5: Run portal E2E tests**

Run: `pnpm exec playwright test --project=patient e2e/portal-telehealth-handoff.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

`git commit -am "feat: simplify patient portal visit workflow"`

---

### Task 8: Reframe Charge Capture and Claims as one visible RCM pipeline

**Files:**
- Modify: `artifacts/therassistant-inventory/src/domains/billing/BillingQueuePage.tsx`
- Modify: claim list/detail components under `artifacts/therassistant-inventory/src/domains/claims/`
- Reuse: existing charge, claim, acknowledgement, 837P, denial, and correction repositories
- Modify/Create: relevant RCM CSS under billing/claims domains
- Modify: `e2e/billing-insured-flow.spec.ts`
- Modify: `e2e/rcm-workqueues.spec.ts`

**Interfaces:**
- Consumes: signed encounter billing readiness and existing charge/claim creation functions.
- Produces: visible RCM stages and exception queues without changing claim generation semantics.

- [ ] **Step 1: Separate normal flow from exceptions**

Normal stages: Needs Review → Ready → Charges → Claims → Batches. Blocked items become an exception queue with the reason and corrective deep link.

- [ ] **Step 2: Normalize claim lifecycle presentation**

Draft, Scrub Failed, Ready to Submit, Submitted, Accepted, Rejected, Paid, Denied map to existing claim/status data without inventing a second status store.

- [ ] **Step 3: Make Claim 360 an investigation workspace**

Place summary, payer/patient/service data, timeline, acknowledgement/denial context, and correction action adjacent to the field/workflow that needs correction.

- [ ] **Step 4: Preserve signed-note immutability**

Add/extend E2E assertions that billing corrections never alter signed `clinical_notes.note_text` or signature state.

- [ ] **Step 5: Run RCM tests**

Run: `pnpm exec playwright test e2e/billing-insured-flow.spec.ts e2e/rcm-workqueues.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

`git commit -am "feat: redesign charge and claim work pipeline"`

---

### Task 9: Full end-to-end release acceptance

**Files:**
- Create: `e2e/appointment-to-claim.spec.ts`
- Modify: `scripts/verify-release-acceptance.mjs` if needed to include the new workflow
- Update: `docs/superpowers/plans/2026-10-12-ehr-ui-workflow-redesign.md` checkboxes/results

**Interfaces:**
- Consumes: all prior tasks.
- Produces: one executable acceptance path proving the redesigned UI is wired to the real workflow.

- [ ] **Step 1: Add appointment-to-claim E2E scenario**

Cover: telehealth appointment → patient check-in + screeners → video handoff → staff review → encounter → pre-visit review/import → Save Draft → Sign & Lock → billing-ready → charge → claim → scrub/correction path.

- [ ] **Step 2: Assert provenance and immutability**

Patient-authored import remains labeled; repeat import does not duplicate; signed note text/signature remain unchanged after downstream billing correction.

- [ ] **Step 3: Run complete verification suite**

Run: `pnpm test:workflow && pnpm run typecheck && pnpm run test:e2e && pnpm run verify:release-acceptance`
Expected: all PASS.

- [ ] **Step 4: Verify production build**

Run: `pnpm run build`
Expected: PASS with no type/build errors.

- [ ] **Step 5: Review changed files for secrets/PHI leakage**

Confirm no Daily API key, access token, patient identifier, or PHI is logged or committed.

- [ ] **Step 6: Commit**

`git commit -am "test: verify appointment to claim workflow"`

## Self-Review Results

- **Spec coverage:** All approved workflow stages are assigned to Tasks 2–9; administrative/credentialing/report visual refinements are intentionally outside this implementation slice because they do not block the appointment-to-claim workflow.
- **Type consistency:** Screener state has one normalized `ScreenerSummary`; telehealth has one server session endpoint and one normalized client state model.
- **Risk coverage:** Incomplete screeners, missing telehealth configuration, repeated submission, unsaved signing, and signed-note billing correction are explicitly tested.
- **Scope control:** The plan reuses existing repositories and routes and avoids replacing the scheduling, clinical, billing, or claims engines.
