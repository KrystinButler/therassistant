import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = () => readFileSync(fileURLToPath(new URL("../src/domains/clinical/psychotherapy-note-repository.ts", import.meta.url)), "utf8");

test("private psychotherapy notes use their own storage table", () => {
  const text = source();
  assert.match(text, /psychotherapy_notes/);
  assert.match(text, /savePsychotherapyNote/);
  assert.match(text, /getPsychotherapyNote/);
  assert.doesNotMatch(text, /clinical_notes/);
});
