import test from "node:test";
import assert from "node:assert/strict";

import {
  assertAppealAllowed,
  classifyDenialPolicy,
  createAppealInput,
} from "../src/domains/ar/denials";

test("denial policy separates write-off categories from workable denials", () => {
  assert.equal(classifyDenialPolicy("credentialing"), "auto_writeoff");
  assert.equal(classifyDenialPolicy("contracting"), "auto_writeoff");
  assert.equal(classifyDenialPolicy("authorization"), "workable");
  assert.equal(classifyDenialPolicy("timely_filing"), "workable");
  assert.equal(classifyDenialPolicy("other"), "needs_review");
});

test("appeal is blocked for policy write-off denials and duplicate active appeals", () => {
  assert.throws(() => assertAppealAllowed({ category: "contracting", hasActiveAppeal: false }));
  assert.throws(() => assertAppealAllowed({ category: "authorization", hasActiveAppeal: true }));
  assert.doesNotThrow(() => assertAppealAllowed({ category: "authorization", hasActiveAppeal: false }));
});

test("appeal input preserves claim and denial traceability", () => {
  const input = createAppealInput(
    { id: "d1", claim_id: "c1", denial_category: "authorization" },
    1,
    "2026-10-15",
    "Authorization was valid on DOS.",
  );
  assert.equal(input.denial_id, "d1");
  assert.equal(input.claim_id, "c1");
  assert.equal(input.appeal_level, 1);
  assert.equal(input.appeal_status, "drafting");
  assert.equal(input.due_date, "2026-10-15");
});
