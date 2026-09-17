import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const authClientSource = readFileSync(
  new URL("../src/lib/supabase-client.ts", import.meta.url),
  "utf8",
);
const authContextSource = readFileSync(
  new URL("../src/auth/auth-context.tsx", import.meta.url),
  "utf8",
);
const loginSource = readFileSync(
  new URL("../src/auth/LoginPage.tsx", import.meta.url),
  "utf8",
);
const appSource = readFileSync(
  new URL("../src/App.tsx", import.meta.url),
  "utf8",
);

test("stored staff sessions are revalidated with Supabase Auth before use", () => {
  assert.match(authClientSource, /validateSessionWithAuth/);
  assert.match(authClientSource, /\/auth\/v1\/user/);
  assert.match(authClientSource, /persistSession\(null\)/);
});

test("staff password recovery can request a reset and set a new password", () => {
  assert.match(authClientSource, /requestPasswordRecovery/);
  assert.match(authClientSource, /\/auth\/v1\/recover/);
  assert.match(authClientSource, /updatePassword/);
  assert.match(authClientSource, /method:\s*["']PUT["']/);
  assert.match(authClientSource, /recovery/);
  assert.match(authContextSource, /requestPasswordReset/);
  assert.match(authContextSource, /completePasswordRecovery/);
  assert.match(appSource, /PasswordRecoveryPage/);
});

test("login exposes password recovery but no public signup surface", () => {
  assert.match(loginSource, /Forgot password\?/);
  assert.doesNotMatch(loginSource, /sign up|create account|register/i);
  assert.doesNotMatch(authClientSource, /\/auth\/v1\/signup/);
});
