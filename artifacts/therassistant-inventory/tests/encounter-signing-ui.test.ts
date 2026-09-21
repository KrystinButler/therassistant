import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("../src/domains/encounters/EncounterPage.tsx", import.meta.url)),
  "utf8",
);

test("signing saves the current editable note before locking it", () => {
  const signStart = source.indexOf("async function sign()");
  const saveCall = source.indexOf("await saveClinicalNote(encounterId", signStart);
  const signCall = source.indexOf("await signEncounterNote(encounterId", signStart);

  assert.ok(signStart >= 0);
  assert.ok(saveCall > signStart, "Sign action must persist the current editor content.");
  assert.ok(signCall > saveCall, "The persisted current note must be saved before signature.");
});
