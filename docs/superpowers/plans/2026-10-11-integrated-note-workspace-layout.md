# Integrated Clinical Encounter Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the visually unchanged legacy encounter shell with the intended THERASSISTANT Live Encounter + Active Progress Note workspace while preserving existing clinical, safety, coding, and signing behavior.

**Architecture:** Keep the existing EncounterPage data/actions intact and change the presentation layer around those controls. Use a dedicated layout stylesheet loaded by the clinical workspace to turn the existing DOM into the intended desktop workspace: telehealth/session on the left, active note in the center, clinical context on the right, with Today’s Focus remaining above the workspace. Preserve responsive fallback to a single-column workflow.

**Tech Stack:** React, TypeScript, Vite, CSS, Node test runner.

**Spec:** THERASSISTANT EHR Product Vision, Section 3: Clinical Documentation & Charge Readiness — Live Encounter + Active Progress Note.

## Global Constraints

- Do not change Save Note vs Sign & Lock semantics.
- Do not make billing/coding readiness block clinical signing.
- Patient-submitted content remains clearly labeled and provider-controlled before signature.
- Private psychotherapy notes remain separate.
- Existing PRSDS, PHQ-9, GAD-7, C-SSRS, cross-system safety, coding review, and telemetry remain visible and usable.
- Desktop layout must visibly match the product vision: session/video left, documentation center/right, context immediately accessible.

## Review Focus

- Non-telehealth encounters must not leave an empty video column.
- Tablet/mobile must collapse without horizontal overflow.
- Context tabs remain keyboard-usable and content remains reachable.
- Signed notes remain read-only and retain Sign/Charge handoff behavior.
- Empty check-in/journal/screening states remain understandable rather than disappearing.

---

### Task 1: Add a regression test for the intended encounter structure

**Files:**
- Create: `artifacts/therassistant-inventory/tests/integrated-note-workspace-layout.test.ts`

- [ ] Assert the integrated layout stylesheet exists and defines telehealth-aware desktop columns, a dedicated note column, a context column, and responsive collapse.
- [ ] Assert the layout preserves visible Portal Import, clinical signals, cross-system monitoring, telemetry, and signing surfaces.
- [ ] Run the test first and confirm it fails before implementation.

### Task 2: Implement the product-vision encounter layout

**Files:**
- Create: `artifacts/therassistant-inventory/src/domains/clinical/integrated-encounter-layout.css`
- Modify: `artifacts/therassistant-inventory/src/domains/clinical/cross-system-testability.css`

- [ ] Load the new layout stylesheet from the existing clinical workspace stylesheet.
- [ ] Make the encounter note card a telehealth-aware grid.
- [ ] Position the TelehealthVisit surface in the left session column.
- [ ] Keep note controls/editor/save/sign flow in the documentation column.
- [ ] Present patient-submitted information, signals, screenings, Golden Thread context, telemetry, private note, and coding review as the right-side clinical context rail.
- [ ] Make the existing context drawer horizontal/secondary so it no longer consumes half of the encounter.
- [ ] Preserve a one-column mobile/tablet fallback.

### Task 3: Verify and release

- [ ] Run the complete test suite.
- [ ] Run TypeScript phase-3 typecheck.
- [ ] Run the Vite production build.
- [ ] Review the generated CSS bundle for the new integrated-workspace selectors.
- [ ] Merge only after the verified preview is READY.
- [ ] Verify the production alias serves the new asset hash.