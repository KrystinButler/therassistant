# Provider Schedule + Patient Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `/schedule` into the provider-facing day workspace shown in the approved references and add a data-connected `PatientReviewDrawer` that surfaces check-in, journal, treatment-plan, prior-session, safety, and readiness context without leaving the schedule.

**Architecture:** Keep `SchedulePage` mounted and retain the existing Day/Week/Month filters and appointment edit drawer. Extend the scheduling repository with one aggregated pre-visit context model assembled from existing appointment, check-in, journal, treatment-plan, encounter, and clinical-note records. Render the new provider day view from that model; selecting a patient opens `PatientReviewDrawer` using the existing `WorkDrawer`, while Start Note reuses `startEncounter()` and Open Chart uses the existing patient 360 route.

**Tech Stack:** React, TypeScript, Vite, Wouter, existing Radix-backed `WorkDrawer`, existing THERASSISTANT CSS/status components, existing Supabase demo repository utilities, Node `node:test` for pure workflow tests.

**Spec:** `docs/superpowers/specs/2026-09-15-integrated-ehr-workspaces-design.md`

## Global Constraints

- Preserve `/schedule`, `/schedule/:id`, `/clients/:id`, and `/encounters/:id` routes.
- Preserve existing appointment create/edit/status business logic and the current appointment `WorkDrawer`.
- Use existing repositories/workflow functions; do not query Supabase directly from presentation components.
- Do not expose internal UUIDs when a readable patient/provider/payer identifier exists.
- Patient-authored check-in and journal content must be visually distinguished from provider-authored clinical documentation.
- Day view becomes the primary clinical operating view, but Week and Month modes remain functional.
- Closing `PatientReviewDrawer` must not reset date, view mode, provider filter, status filter, or page scroll intentionally.
- Do not introduce another UI library.
- No browser `alert()` or `prompt()` interactions.
- Run typecheck, affected tests, and production build before the phase is considered complete.

---

## File structure

- Create `artifacts/therassistant-inventory/src/domains/portal/check-in-contract.ts` — canonical typed keys for patient pre-visit responses shared by provider schedule and the later patient-portal phase.
- Create `artifacts/therassistant-inventory/src/domains/scheduling/patient-review.ts` — pure aggregation/presentation helpers and `PatientReviewContext` contract.
- Create `artifacts/therassistant-inventory/src/domains/scheduling/PatientReviewDrawer.tsx` — provider-facing review drawer.
- Create `artifacts/therassistant-inventory/src/domains/scheduling/schedule-workspace.css` — day-table and review-card styling local to scheduling.
- Create `artifacts/therassistant-inventory/tests/patient-review.test.ts` — pure behavior tests.
- Modify `artifacts/therassistant-inventory/src/domains/scheduling/repository.ts` — load and aggregate check-in/journal/treatment/prior-session context.
- Modify `artifacts/therassistant-inventory/src/domains/scheduling/SchedulePage.tsx` — provider day view, patient selection, drawer integration, Start Note action.

### Task 1: Define the shared pre-visit response contract

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/portal/check-in-contract.ts`
- Test: `artifacts/therassistant-inventory/tests/patient-review.test.ts`

**Interfaces:**
- Produces `PreVisitResponses` with stable keys consumed by the future portal check-in form and current provider review.
- Produces `normalizePreVisitResponses(value: unknown): PreVisitResponses`.

- [ ] **Step 1: Write the failing contract test**

Add this test skeleton:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { normalizePreVisitResponses } from "../src/domains/portal/check-in-contract.ts";

test("normalizes supported pre-visit response keys and ignores unknown values", () => {
  assert.deepEqual(
    normalizePreVisitResponses({
      focus_today: "Work stress",
      mood_since_last_visit: "More anxious",
      recent_changes: "New job",
      safety_concerns: "No",
      goal_focus: "Use breathing skills",
      provider_message: "Discuss boundaries",
      unrelated: "ignore me",
    }),
    {
      focusToday: "Work stress",
      moodSinceLastVisit: "More anxious",
      recentChanges: "New job",
      safetyConcerns: "No",
      goalFocus: "Use breathing skills",
      providerMessage: "Discuss boundaries",
    },
  );
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node --experimental-strip-types --test artifacts/therassistant-inventory/tests/patient-review.test.ts
```

Expected: FAIL because `check-in-contract.ts` does not exist.

- [ ] **Step 3: Implement the contract**

Create:

```ts
export type PreVisitResponses = {
  focusToday?: string;
  moodSinceLastVisit?: string;
  recentChanges?: string;
  safetyConcerns?: string;
  goalFocus?: string;
  providerMessage?: string;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizePreVisitResponses(value: unknown): PreVisitResponses {
  if (!value || typeof value !== "object") return {};
  const row = value as Record<string, unknown>;
  return {
    focusToday: text(row.focus_today),
    moodSinceLastVisit: text(row.mood_since_last_visit),
    recentChanges: text(row.recent_changes),
    safetyConcerns: text(row.safety_concerns),
    goalFocus: text(row.goal_focus),
    providerMessage: text(row.provider_message),
  };
}
```

Do not add alternate key spellings here; the portal phase must write these canonical snake-case storage keys.

- [ ] **Step 4: Run the test and verify it passes**

Run the same `node --experimental-strip-types --test ...` command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/portal/check-in-contract.ts artifacts/therassistant-inventory/tests/patient-review.test.ts
git commit -m "feat: define pre-visit response contract"
```

### Task 2: Build the pure patient-review model

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/scheduling/patient-review.ts`
- Modify: `artifacts/therassistant-inventory/tests/patient-review.test.ts`

**Interfaces:**
- Produces `PatientReviewContext`.
- Produces `buildPatientReviewContext(input): PatientReviewContext`.
- Produces `deriveCheckInDisplay(checkin): "Ready" | "In Progress" | "Not Checked In"`.

`PatientReviewContext` must contain:

```ts
export type PatientReviewContext = {
  checkInStatus: "Ready" | "In Progress" | "Not Checked In";
  checkInResponses: PreVisitResponses;
  latestSharedJournal: null | {
    id: string;
    createdAt: string;
    mood: string | null;
    text: string;
  };
  activeGoal: null | {
    id: string;
    text: string;
    status: string;
    targetDate: string | null;
  };
  priorSessionPlan: string | null;
  sessionFocus: string;
  preVisitInsight: string;
  safetySummary: string;
  hasSafetyConcern: boolean;
};
```

- [ ] **Step 1: Add failing behavior tests**

Cover these cases:

```ts
test("checked-in patient is Ready and patient focus wins the session-focus fallback chain", () => {
  const result = buildPatientReviewContext({
    checkin: { checked_in_at: "2026-09-15T15:00:00Z", responses: { focus_today: "Managing anxiety at work", safety_concerns: "No" } },
    journals: [],
    activeGoal: { id: "goal-1", goal_text: "Reduce anxiety", status: "in_progress" },
    priorNote: { plan_text: "Continue grounding skills" },
  });
  assert.equal(result.checkInStatus, "Ready");
  assert.equal(result.sessionFocus, "Managing anxiety at work");
  assert.equal(result.hasSafetyConcern, false);
});

test("shared journal is selected while private journal is excluded", () => {
  const result = buildPatientReviewContext({
    checkin: null,
    journals: [
      { id: "private", entry_text: "private", share_with_provider: false, created_at: "2026-09-15T12:00:00Z" },
      { id: "shared", entry_text: "shared", share_with_provider: true, created_at: "2026-09-14T12:00:00Z" },
    ],
    activeGoal: null,
    priorNote: null,
  });
  assert.equal(result.latestSharedJournal?.id, "shared");
});

test("affirmative safety text is surfaced as a concern", () => {
  const result = buildPatientReviewContext({
    checkin: { responses: { safety_concerns: "Yes - thoughts of self-harm" } },
    journals: [],
    activeGoal: null,
    priorNote: null,
  });
  assert.equal(result.hasSafetyConcern, true);
});
```

- [ ] **Step 2: Run tests and verify failure**

Expected: FAIL because `patient-review.ts` does not exist.

- [ ] **Step 3: Implement deterministic fallback rules**

Use these exact rules:

```ts
sessionFocus =
  responses.focusToday ??
  responses.goalFocus ??
  activeGoalText ??
  priorSessionPlan ??
  "Review progress and current needs.";

preVisitInsight =
  responses.moodSinceLastVisit ??
  responses.recentChanges ??
  (latestSharedJournal ? "Shared a journal entry before this visit." : "No new patient-reported update.");
```

`deriveCheckInDisplay` uses `checked_in_at` first, then `arrived_at`/`on_my_way_at`, then no timestamps. Safety evaluation is deliberately conservative and textual for this UI phase: blank/`no`/`none`/`no concerns` are not flagged; other non-empty text is flagged. This does not replace a clinical risk assessment.

For prior-session plan, read the first non-empty value from `plan_text`, `plan`, or `goal_addressed`; do not parse arbitrary prose from `note_text`.

For journal visibility, include entries when `share_with_provider === true` or `visibility === "shared_with_provider"`; exclude entries explicitly marked private. Sort by `entry_date`, then `created_at`, descending.

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
node --experimental-strip-types --test artifacts/therassistant-inventory/tests/patient-review.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/scheduling/patient-review.ts artifacts/therassistant-inventory/tests/patient-review.test.ts
git commit -m "feat: build patient review context"
```

### Task 3: Aggregate real pre-visit context in the scheduling repository

**Files:**
- Modify: `artifacts/therassistant-inventory/src/domains/scheduling/repository.ts`

**Interfaces:**
- Extend `ScheduleAppointment` with `clientPronouns: string | null` and `patientReview: PatientReviewContext`.
- `getScheduleData()` remains the only page-level loader for `/schedule`.
- `getPreSessionData()` continues returning the enriched appointment without a separate duplicate query path.

- [ ] **Step 1: Add repository source queries**

Extend the existing `Promise.all` to load:

```ts
demoSelect<DataRow>("client_checkins"),
demoSelect<DataRow>("patient_journal_entries", { order: "entry_date.desc,created_at.desc" }),
demoSelect<DataRow>("treatment_plan_goals", { order: "created_at.asc" }),
demoSelect<DataRow>("encounters", { order: "started_at.desc" }),
demoSelect<DataRow>("clinical_notes", { order: "created_at.desc" }),
```

Keep existing appointment/policy/eligibility/authorization/enrollment/treatment-plan reads unchanged.

- [ ] **Step 2: Add small lookup helpers**

Implement helpers scoped to `repository.ts`:

```ts
function checkinForAppointment(rows: DataRow[], appointmentId: string) {
  return rows
    .filter((row) => row.appointment_id === appointmentId)
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0] ?? null;
}

function journalsForClient(rows: DataRow[], clientId: string) {
  return rows.filter((row) => row.client_id === clientId);
}
```

For `activeGoal`, use only goals belonging to the already-selected current treatment plan. Prefer statuses `active`, `in_progress`, `on_track`; otherwise use the first goal for the plan.

For `priorNote`, select the latest encounter for the same client whose `started_at` is earlier than the current appointment `starts_at`, then select the newest clinical note for that encounter.

- [ ] **Step 3: Populate the new appointment fields**

Inside the existing appointment map:

```ts
const client = clientsById.get(clientId);
const checkin = checkinForAppointment(checkins, appointment.id);
const planGoals = treatmentPlan ? goals.filter((row) => row.treatment_plan_id === treatmentPlan.id) : [];
const activeGoal = planGoals.find((row) => ["active", "in_progress", "on_track"].includes(String(row.status ?? ""))) ?? planGoals[0] ?? null;
const priorEncounter = latestPriorEncounter(encounters, clientId, String(appointment.starts_at ?? ""));
const priorNote = priorEncounter ? latestNoteForEncounter(notes, priorEncounter.id) : null;

const patientReview = buildPatientReviewContext({
  checkin,
  journals: journalsForClient(journalEntries, clientId),
  activeGoal,
  priorNote,
});
```

Set `clientPronouns` from `client.pronouns` when non-empty.

- [ ] **Step 4: Typecheck**

Run:

```bash
pnpm --filter @workspace/therassistant-inventory typecheck
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/scheduling/repository.ts
git commit -m "feat: aggregate schedule pre-visit context"
```

### Task 4: Build `PatientReviewDrawer`

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/scheduling/PatientReviewDrawer.tsx`
- Create: `artifacts/therassistant-inventory/src/domains/scheduling/schedule-workspace.css`

**Interfaces:**

```ts
type PatientReviewDrawerProps = {
  appointment: ScheduleAppointment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenChart: () => void;
  onStartEncounter: () => Promise<void>;
  startingEncounter: boolean;
  error?: string | null;
};
```

- [ ] **Step 1: Implement the drawer shell**

Use `WorkDrawer`, not a centered modal. Header shows patient, pronouns, appointment time, service type, and current appointment/check-in badge. `openFullRecord` points to the existing pre-session record only if needed; the footer primary actions remain Open Chart and Start Note.

- [ ] **Step 2: Render review sections**

Render compact sections in this order:

1. Check-In Summary — focus, mood, recent changes, provider message.
2. Journal Review — latest shared entry only; mark it `Patient submitted`.
3. Session Focus.
4. Active Goal — goal text, status, target date.
5. Prior Session Plan.
6. Safety Review — green no-concern treatment when false; red blocking visual when `hasSafetyConcern` is true, preserving the patient’s text.
7. Visit Readiness — overall ready/blocked plus each existing readiness check.

Do not copy journal or check-in text into the clinical record from this drawer.

- [ ] **Step 3: Add local responsive CSS**

Create scheduling-specific classes such as:

```css
.thera-schedule-day-row { display: grid; grid-template-columns: 90px minmax(160px,1.1fr) 150px minmax(180px,1.3fr) minmax(180px,1.2fr) 32px; }
.thera-review-section { border: 1px solid hsl(var(--border)); border-radius: var(--radius); padding: 1rem; background: hsl(var(--card)); }
.thera-review-patient-source { border-left: 3px solid hsl(var(--chart-2)); }
```

At widths below 900px, allow the day row to collapse into a card-like grid; never horizontally hide patient or readiness information.

- [ ] **Step 4: Typecheck/build**

Run:

```bash
pnpm --filter @workspace/therassistant-inventory typecheck
pnpm --filter @workspace/therassistant-inventory build
```

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/scheduling/PatientReviewDrawer.tsx artifacts/therassistant-inventory/src/domains/scheduling/schedule-workspace.css
git commit -m "feat: add patient review drawer"
```

### Task 5: Redesign the Schedule Day view without breaking Week/Month

**Files:**
- Modify: `artifacts/therassistant-inventory/src/domains/scheduling/SchedulePage.tsx`

**Interfaces:**
- `selectedAppointmentId: string | null` owns review selection.
- Existing `form`, `baseline`, and `editingId` continue owning appointment create/edit drawer state.
- Only one drawer is open at once: opening appointment edit clears review selection; opening review closes appointment form state.

- [ ] **Step 1: Add selection state and helper**

Add:

```ts
const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);
const selectedAppointment = data?.appointments.find((row) => row.id === selectedAppointmentId) ?? null;
```

`openEdit()` must call `setSelectedAppointmentId(null)`. A new `openReview(appointment)` must close appointment form state before setting selection.

- [ ] **Step 2: Make Day the initial view**

Change only the default:

```ts
const [view, setView] = useState<ViewMode>("day");
```

Do not remove Week or Month controls.

- [ ] **Step 3: Render the provider day workspace**

When `view === "day"`, replace the generic table body with columns matching the approved concept:

- Time
- Patient
- Check-In Status
- Pre-Visit Insight
- Session Focus
- row action/chevron

Patient displays `clientName` and pronouns only when available. Check-In uses `appointment.patientReview.checkInStatus`. Pre-Visit Insight shows `preVisitInsight` and compact indicators such as `Journal shared` only when `latestSharedJournal` exists. Session Focus shows `sessionFocus` plus the existing overall readiness badge.

Clicking the patient name, row, or chevron opens review; do not navigate away.

When `view !== "day"`, retain the current operational table and existing actions rather than forcing the denser day layout into week/month modes.

- [ ] **Step 4: Preserve appointment actions**

Keep New Appointment and Edit Appointment in the existing `WorkDrawer`. Confirm, Check In, No Show, Cancel, and Pre-Session remain reachable in non-day modes and may be exposed from the review drawer/header where appropriate; do not delete workflow actions in this visual refactor.

- [ ] **Step 5: Verify state persistence manually**

Set provider/status filters, choose a date, scroll the day schedule, open and close Patient Review. Verify filter/date/view values remain unchanged and closing the drawer does not intentionally reset scroll.

- [ ] **Step 6: Typecheck/build**

Run the standard inventory typecheck/build commands.

- [ ] **Step 7: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/scheduling/SchedulePage.tsx
git commit -m "feat: redesign provider day schedule"
```

### Task 6: Wire Start Note / Start Encounter from Patient Review

**Files:**
- Modify: `artifacts/therassistant-inventory/src/domains/scheduling/SchedulePage.tsx`
- Modify: `artifacts/therassistant-inventory/src/domains/scheduling/PatientReviewDrawer.tsx`

**Interfaces:**
- Reuse `startEncounter(appointmentId)` from `../encounters/repository`.
- Successful result navigates to `/encounters/${result.value.id}`.
- Failed result stays on `/schedule` with drawer open and shows the returned readiness/blocking message.

- [ ] **Step 1: Add the start handler**

Use Wouter `useLocation()`:

```ts
const [, navigate] = useLocation();
const [startingEncounter, setStartingEncounter] = useState(false);

async function startSelectedEncounter() {
  if (!selectedAppointment) return;
  setStartingEncounter(true);
  setError(null);
  try {
    const result = await startEncounter(selectedAppointment.id);
    if (!result.ok) {
      setError(result.details?.length ? `${result.message} ${result.details.join(" ")}` : result.message);
      return;
    }
    navigate(`/encounters/${result.value.id}`);
  } catch (err) {
    setError(err instanceof Error ? err.message : "Unable to start encounter.");
  } finally {
    setStartingEncounter(false);
  }
}
```

- [ ] **Step 2: Wire footer actions**

Open Chart navigates to `/clients/${appointment.clientId}`. Start Note calls the handler above and is disabled while starting. Do not bypass readiness by directly creating an encounter in the component.

- [ ] **Step 3: Add/extend workflow regression test**

Do not duplicate the existing encounter workflow unit tests. Run the existing encounter/scheduling tests plus the new patient-review test. If the repository contains a named encounter workflow test, include it in the command; otherwise run the whole inventory test directory with Node’s test runner only if the environment already supports TypeScript stripping.

Minimum required commands:

```bash
node --experimental-strip-types --test artifacts/therassistant-inventory/tests/patient-review.test.ts
node --experimental-strip-types --test artifacts/therassistant-inventory/tests/scheduling-workflow.test.ts
```

- [ ] **Step 4: Typecheck/build**

Run inventory typecheck and build. Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add artifacts/therassistant-inventory/src/domains/scheduling
git commit -m "feat: start encounters from patient review"
```

### Task 7: Phase regression and responsive verification

**Files:**
- Modify only files needed for regression fixes.

- [ ] **Step 1: Run automated checks**

```bash
node --experimental-strip-types --test artifacts/therassistant-inventory/tests/patient-review.test.ts
node --experimental-strip-types --test artifacts/therassistant-inventory/tests/scheduling-workflow.test.ts
pnpm --filter @workspace/therassistant-inventory typecheck
pnpm --filter @workspace/therassistant-inventory build
```

All must exit 0.

- [ ] **Step 2: Route smoke**

Verify:

- `/schedule` loads.
- `/schedule/:id` still loads the permanent Pre-Session record.
- `/clients/:id` still opens from Patient Review.
- Start Note creates/reuses an encounter through `startEncounter()` and navigates to `/encounters/:id` only on success.

- [ ] **Step 3: Data-state smoke**

Use synthetic records representing:

- checked-in patient with check-in answers,
- patient with a shared journal entry,
- patient without journal/check-in data,
- active treatment goal,
- blocking readiness issue,
- safety concern text.

Confirm empty sections use concise empty states and never invent content.

- [ ] **Step 4: Interaction smoke**

Verify:

- Day is default.
- Week and Month still work.
- Provider/status filters survive review open/close.
- Appointment Create/Edit drawer still works.
- Patient Review and Appointment Edit drawers do not overlap.
- Patient-authored content is labeled distinctly.
- No UUIDs are visible in the new schedule/review surfaces.

- [ ] **Step 5: Responsive/accessibility smoke**

At desktop, tablet, and mobile widths verify the day row/card remains readable, WorkDrawer is full/nearly full width on mobile, keyboard focus enters the drawer, Escape/close returns to the schedule, controls have visible labels, and readiness/safety are communicated with text rather than color alone.

- [ ] **Step 6: Commit regression fixes if required**

```bash
git add artifacts/therassistant-inventory/src/domains/scheduling artifacts/therassistant-inventory/src/domains/portal/check-in-contract.ts artifacts/therassistant-inventory/tests/patient-review.test.ts
git commit -m "fix: verify provider schedule patient review"
```

## Completion criteria

This plan is complete when `/schedule` opens in a provider-oriented Day view that resembles the approved reference, each appointment has meaningful pre-visit insight sourced from existing records, selecting a patient opens a right-side Patient Review drawer without losing schedule state, the drawer displays check-in/journal/goal/prior-plan/safety/readiness context, Open Chart and Start Note use existing routes/workflows, Week/Month and appointment management remain intact, and all listed tests/typecheck/build checks pass.
