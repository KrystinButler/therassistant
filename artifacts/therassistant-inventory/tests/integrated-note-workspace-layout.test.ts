import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const clinicalDir = path.join(here, "..", "src", "domains", "clinical");
const encounterDir = path.join(here, "..", "src", "domains", "encounters");
const layoutPath = path.join(clinicalDir, "integrated-encounter-layout.css");
const bridgePath = path.join(clinicalDir, "cross-system-testability.css");
const encounterPath = path.join(encounterDir, "EncounterPage.tsx");

test("clinical encounter uses the intended integrated live-session note layout", () => {
  assert.equal(existsSync(layoutPath), true, "integrated encounter layout stylesheet must exist");
  const css = readFileSync(layoutPath, "utf8");
  const bridge = readFileSync(bridgePath, "utf8");
  const encounter = readFileSync(encounterPath, "utf8");

  assert.match(bridge, /integrated-encounter-layout\.css/);
  assert.match(css, /\.encounter-note-card:has\(/);
  assert.match(css, /grid-template-columns:/);
  assert.match(css, /section\[aria-label="Telehealth visit"\]/);
  assert.match(css, /--encounter-note-column/);
  assert.match(css, /--encounter-context-column/);
  assert.match(encounter, /encounter-documentation-column/);
  assert.match(encounter, /encounter-patient-context/);
  assert.doesNotMatch(css, /grid-template-rows:\s*auto repeat/);
  assert.match(css, /PORTAL IMPORT/);
  assert.match(css, /@media\s*\(max-width:\s*1180px\)/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);

  assert.match(encounter, /TODAY&apos;S FOCUS/);
  assert.match(encounter, /<ClinicalNoteWorkspace/);
  assert.match(encounter, /<TelehealthVisit/);
  assert.match(encounter, /Save Draft/);
  assert.match(encounter, /Save & Sign/);
});

test("new clinical safety and outcome surfaces remain part of the integrated workspace", () => {
  const css = readFileSync(layoutPath, "utf8");
  const workspace = readFileSync(path.join(clinicalDir, "ClinicalNoteWorkspace.tsx"), "utf8");

  assert.match(css, /clinical-signals-strip/);
  assert.match(css, /cross-system-monitor/);
  assert.match(css, /clinical-telemetry-prominent/);
  assert.match(workspace, /PHQ-9/);
  assert.match(workspace, /GAD-7/);
  assert.match(workspace, /PRSDS/);
  assert.match(workspace, /C-SSRS/);
  assert.match(workspace, /Psychotherapy Note/);
  assert.match(workspace, /Coding Review/);
});
