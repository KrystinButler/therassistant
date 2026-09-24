import test from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";
const page=readFileSync(new URL("../src/domains/scheduling/PatientReviewDrawer.tsx",import.meta.url),"utf8");
const css=readFileSync(new URL("../src/domains/scheduling/patient-review-drawer.css",import.meta.url),"utf8");
test("patient review has a two-column desktop dashboard and two-column check-in summary",()=>{
  assert.match(css,/patient-review-sections\{display:grid;grid-template-columns:repeat\(2/);
  assert.match(css,/patient-review-section-body\.checkin\{display:grid;grid-template-columns:repeat\(2/);
  assert.match(page,/title="Check-In Summary" wide/);
  assert.match(css,/patient-review-definition p,[^\n]*font-size:\.84rem/);
  assert.match(css,/@media\(max-width:760px\)/);
});
test("review labels unsubmitted check-ins and unknown safety status without implying clinical findings",()=>{
  assert.match(page,/review.hasSubmittedPreVisit \? "Patient submitted" : "Chart context"/);
  assert.match(page,/review.safety === false \? "positive" : "neutral"/);
  assert.match(page,/patient-review-empty-value/);
  assert.match(page,/onClick=\{\(\) => void startNote\(\)\}/);
});
