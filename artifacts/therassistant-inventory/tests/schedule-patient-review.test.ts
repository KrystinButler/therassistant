import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src");
const schedule = readFileSync(join(src, "domains", "scheduling", "SchedulePage.tsx"), "utf8");
const workflow = readFileSync(join(src, "domains", "scheduling", "workflow.ts"), "utf8");
const app = readFileSync(join(src, "App.tsx"), "utf8");

test("schedule is the PREPARE pre-session workflow", () => {
  assert.match(schedule, /My Schedule/);
  assert.match(schedule, /PREPARE · PROVIDER SCHEDULE/);
  assert.match(schedule, /PatientReviewDrawer/);
  assert.match(schedule, /Pre-Visit Insight/);
  assert.match(schedule, /Session Focus/);
  assert.doesNotMatch(schedule, /href=\{?\`?\/schedule\/\$\{/);
  assert.match(schedule, /NOW/);
  assert.match(schedule, /NEXT/);
  assert.match(schedule, /roles\.includes\("clinician"\)/);
  assert.match(schedule, /signedInProvider/);
  assert.match(schedule, /__unlinked_clinician__/);
  assert.match(schedule, /setInterval/);
  assert.match(schedule, /onKeyDown/);
  assert.doesNotMatch(app, /<PreSessionPage/);
});

test("schedule exposes only limited pre-visit insight", () => {
  for (const state of ["Not Checked In", "Balance Issues", "In Progress", "Ready"]) {
    assert.match(workflow, new RegExp(state));
  }
  assert.match(workflow, /label: "Check-In"/);
  assert.match(workflow, /negativeSignal \? "Negative" : "Positive"/);
  assert.match(workflow, /label: "Journal"/);
  assert.doesNotMatch(workflow, /Since last visit|Important changes|Safety concerns|Anything else/);
});

test("patient review drawer exposes the requested clinical review sections", () => {
  const drawer = readFileSync(join(src, "domains", "scheduling", "PatientReviewDrawer.tsx"), "utf8");
  for (const label of [
    "Patient Review",
    "Check-In Summary",
    "Journal Review",
    "Session Focus",
    "Active Goal",
    "Prior Session Plan",
    "Safety Review",
    "Visit Readiness",
    "Open Chart",
    "Start Note",
    "Resume Note",
    "Patient submitted",
    "Edit appointment",
  ]) assert.match(drawer, new RegExp(label));
});
