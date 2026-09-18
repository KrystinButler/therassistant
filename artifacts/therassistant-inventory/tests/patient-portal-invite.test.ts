import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  decideInviteAction,
  isExistingUserError,
  normalizeInviteRequest,
} from "../../../supabase/functions/invite-patient-portal/logic.ts";

const indexPath = fileURLToPath(
  new URL("../../../supabase/functions/invite-patient-portal/index.ts", import.meta.url),
);

test("invite request requires a UUID-like client id", () => {
  assert.throws(() => normalizeInviteRequest({ client_id: "" }), /valid patient ID/i);
  assert.equal(
    normalizeInviteRequest({ client_id: "11111111-1111-4111-8111-111111111111" }).clientId,
    "11111111-1111-4111-8111-111111111111",
  );
});

test("existing live portal access is idempotent", () => {
  assert.equal(decideInviteAction("active"), "return-existing");
  assert.equal(decideInviteAction("invited"), "return-existing");
  assert.equal(decideInviteAction("revoked"), "invite");
  assert.equal(decideInviteAction(null), "invite");
});

test("existing Auth account errors are classified without auto-linking", () => {
  assert.equal(isExistingUserError("A user with this email already exists"), true);
  assert.equal(isExistingUserError("User already registered"), true);
  assert.equal(isExistingUserError("SMTP connection failed"), false);
});

test("edge function keeps admin credentials server-side and uses current key environment", () => {
  const source = readFileSync(indexPath, "utf8");

  assert.match(source, /SUPABASE_SECRET_KEYS/);
  assert.match(source, /SUPABASE_PUBLISHABLE_KEYS/);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /SUPABASE_ANON_KEY/);
  assert.match(source, /inviteUserByEmail/);
  assert.match(source, /deleteUser/);
  assert.match(source, /PORTAL_BASE_URL/);
  assert.match(source, /get_patient_portal_invite_context/);
  assert.match(source, /auth\.getUser/);

  assert.doesNotMatch(source, /sb_secret_[A-Za-z0-9_-]+/);
  assert.doesNotMatch(source, /service[_-]?role[^\n]*=["'][A-Za-z0-9_.-]+["']/i);
});

test("edge function does not auto-link an unrelated existing Auth account", () => {
  const source = readFileSync(indexPath, "utf8");
  assert.match(source, /It was not linked automatically/);
  assert.doesNotMatch(source, /listUsers\(/);
});
