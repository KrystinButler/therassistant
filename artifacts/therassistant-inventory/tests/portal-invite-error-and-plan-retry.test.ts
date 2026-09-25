import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decideInviteAction, isExistingUserError } from "../../../supabase/functions/invite-patient-portal/logic";

test("structured Supabase existing-account codes are recognized independently of error messages", () => {
  for (const code of ["email_exists", "user_already_exists", "identity_already_exists"]) {
    assert.equal(isExistingUserError("Unprocessable Entity", code), true, code);
  }
  assert.equal(isExistingUserError("already registered"), true);
  assert.equal(isExistingUserError("upstream connection timed out", "service_unavailable"), false);
});

test("existing portal mapping remains idempotent and revoked access cannot be re-invited", () => {
  assert.equal(decideInviteAction("active"), "return-existing");
  assert.equal(decideInviteAction("invited"), "return-existing");
  assert.equal(decideInviteAction("revoked"), "block-revoked");
  assert.equal(decideInviteAction(null), "invite");
});

test("invite endpoint gives an actionable conflict and does not silently link accounts", () => {
  const endpoint = readFileSync(new URL("../../../supabase/functions/invite-patient-portal/index.ts", import.meta.url), "utf8");
  assert.match(endpoint, /isExistingUserError\(inviteError\?\.message, inviteError\?\.code\)/);
  assert.match(endpoint, /existing_auth_account/);
  assert.match(endpoint, /staff_identity_review/);
  assert.match(endpoint, /duplicate \? 409 : 502/);
});

test("encounter goal retry does not duplicate a successfully saved goal", () => {
  const composer = readFileSync(new URL("../src/domains/treatment-plans/EncounterTreatmentPlanComposer.tsx", import.meta.url), "utf8");
  assert.match(composer, /goal && !goalAlreadySaved/);
  assert.match(composer, /setSavedGoalId\(String\(createdGoal\.id\)\)/);
  assert.match(composer, /Finish Saved Goal/);
});
