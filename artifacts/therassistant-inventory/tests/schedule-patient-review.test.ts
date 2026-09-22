import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src");
const schedule = readFileSync(join(src, "domains", "scheduling", "SchedulePage.tsx"), "utf8");
const app = readFileSync(join(src, "App.tsx"), "utf8");

test("schedule is the PREPARE pre-session workflow", () => {
  assert.match(schedule, /Schedule & Pre-Session Review/);
  assert.match(schedule, /PREPARE · PROVIDER SCHEDULE/);
  assert.match(schedule, /PatientReviewDrawer/);
  assert.match(schedule, /Pre-Visit Insight/);
  assert.match(schedule, /Session Focus/);
  assert.doesNotMatch(schedule, /href=\{?\`?\/schedule\/\$\{/);
  assert.doesNotMatch(app, /<PreSessionPage/);
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
  ]) assert.match(drawer, new RegExp(label));
});
