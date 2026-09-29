import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const journalCss = readFileSync(new URL("../src/domains/portal/patient-journal.css", import.meta.url), "utf8");
const checkinCss = readFileSync(new URL("../src/domains/portal/patient-checkin.css", import.meta.url), "utf8");

test("patient portal journal and check-in avoid unreadably tiny text", () => {
  for (const [label, css] of [["journal", journalCss], ["check-in", checkinCss]] as const) {
    assert.doesNotMatch(css, /font-size:\s*[789]px/, `${label} portal styles should not use 7-9px text`);
  }
});

test("patient portal keeps responsive layouts after readability adjustments", () => {
  assert.match(journalCss, /@media \(max-width: 760px\)/);
  assert.match(checkinCss, /@media \(max-width: 700px\)/);
});
