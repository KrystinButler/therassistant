import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(
  new URL("../src/domains/credentialing/CredentialingPage.tsx", import.meta.url),
  "utf8",
);
const creator = readFileSync(
  new URL("../src/domains/credentialing/NewCredentialingCaseDrawer.tsx", import.meta.url),
  "utf8",
);

test("credentialing is wired end to end", () => {
  assert.match(page, /\+ New Credentialing Case/);
  assert.match(creator, /create_credentialing_case/);
  assert.match(page, /transition_credentialing_application/);
  assert.match(page, /credentialing_requirements/);
  assert.match(page, /record_credentialing_followup/);
  assert.match(page, /Record Payer Follow-Up/);
  assert.match(page, /Add Requirement/);
  assert.match(page, /Application Workflow/);
});

test("new credentialing cases use real scoped reference data", () => {
  assert.match(creator, /tenantSelect\("providers"/);
  assert.match(creator, /referenceSelect\("payers"/);
  assert.match(creator, /referenceSelect\("payer_plans"/);
  assert.match(creator, /tenantSelect\("practice_entities"/);
  assert.match(creator, /tenantSelect\("practice_locations"/);
  assert.match(creator, /tenantSelect\("payer_contracts"/);
});
