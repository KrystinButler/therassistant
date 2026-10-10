# Cross-System Clinical Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add the supplied cross-system somatic/MH/SUD documentation, telemetry, coding decision-support, disclaimer, and safety-alert engine to the existing encounter clinical-note workspace.

**Architecture:** Keep clinical documentation and billing readiness separate. Pure TypeScript policy functions sanitize imports, detect somatic rules, evaluate coding sequences, and produce alerts; the encounter UI renders the resulting macros/chart/prompts, while Supabase stores PRSDS and auditable coding decisions. Save hooks append the source-defined scope disclaimer only when a cross-system rule or macro is used.

**Tech Stack:** React/TypeScript, Recharts, Supabase/Postgres/RLS, Node test runner, Vite.

**Spec:** `/mnt/data/Pasted text(20261010-195335).txt`

## Global Constraints
- Configuration version `2026.10.10`; module `Somatic_MentalHealth_SUD_CrossMapping_Engine`.
- Imported text is append-only, sanitized, and capped at 2,000 characters per imported container.
- PHQ-9 scale 0-27, GAD-7 scale 0-21, PRSDS scale 1-10; chart window 90 days.
- C-SSRS remains a safety screening, not an outcome measure.
- Clinical signature remains independent of billing/coding readiness.
- Psychotherapy notes remain separate from ordinary clinical and billing records.

## Review Focus
- Negated emergency phrases must not trigger disruptive alerts.
- Repeated imports must append without overwriting existing clinician text.
- Disclaimer injection must be idempotent and stay immediately above the signature boundary.
- Coding suggestions must not silently mutate encounter diagnoses.
- Signed-note status must not be altered by accepting/rejecting a billing coding recommendation.

---

### Task 1: Pure policy engine and import safety
**Files:** create `src/domains/clinical/cross-system-engine.ts`; test `tests/cross-system-engine.test.ts`.
- [x] RED tests for sanitization, 2,000-char cap, append guard, four somatic rules, emergency negation, substance-induced combinations, F54 sequencing, disclaimer idempotency.
- [x] GREEN minimal pure functions and versioned rule configuration.
- [x] Run focused tests and commit.

### Task 2: PRSDS persistence and audit storage
**Files:** migration `supabase/migrations/20261010203000_cross_system_clinical_engine.sql`; modify outcome model/repository as needed; test migration contract.
- [x] RED tests for PRSDS range and coding-decision audit storage/RLS.
- [x] GREEN migration extending outcome measures to PRSDS and adding `clinical_cross_mapping_decisions`.
- [x] Run focused tests and commit.

### Task 3: Telemetry and SmartPhrase integration
**Files:** modify `ClinicalNoteWorkspace.tsx`, `fast-charting.ts`, encounter CSS; create telemetry component if needed; tests.
- [x] RED tests for 90-day three-series chart and source macros `.somaticGI`, `.somaticPain`, `.somaticCardio`, `.somaticSUD`.
- [x] GREEN render telemetry and float matching macros based on current workspace text.
- [x] Run focused tests and commit.

### Task 4: Encounter safety/coding prompts and save hook
**Files:** modify `EncounterPage.tsx`, `clinical/repository.ts`; create prompt component if needed; tests.
- [x] RED tests for emergency modal, duplication-trap modal, mandatory rejection justification, explicit accept/reject, and disclaimer save hook.
- [x] GREEN integrate pure engine without blocking clinical signature; coding mutations remain explicit user actions.
- [x] Run focused tests and commit.

### Task 5: Release verification
- [x] Run focused clinical/cross-system tests.
- [x] Run TypeScript and Vite production build.
- [x] Apply Supabase migration and verify RLS/schema.
- [x] Push branch, open/merge PR, verify Vercel production deployment and live alias.
