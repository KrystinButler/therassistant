import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("App routes Denials to the dedicated page", () => {
  assert.match(appSource, /import \{ DenialsPage \}/);
  assert.match(appSource, /path="\/denials"[^\n]*<DenialsPage/);
});

test("Denials page is CARC driven with approved special tabs", () => {
  const source = readFileSync(new URL("../src/domains/ar/DenialsPage.tsx", import.meta.url), "utf8");
  assert.match(source, /CARC/);
  assert.match(source, /Corrected Claims/);
  assert.match(source, /Appeals/);
  assert.match(source, /Deferred/);
  assert.match(source, /getDenialTab/);
  for (const removed of ["Insurance A/R", "Patient A/R", "Underpayments", "Recoupments \/ Refunds"]) {
    assert.doesNotMatch(source, new RegExp(`>${removed}<`));
  }
});
