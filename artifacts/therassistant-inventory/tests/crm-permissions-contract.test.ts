import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../../../supabase/functions/crm-api/index.ts", import.meta.url),
  "utf8",
);

test("CRM API requires authenticated users and Payment Desk access", () => {
  assert.match(source, /withSupabase\(\{ auth: ["']user["'] \}/);
  assert.match(source, /payment_desk_users/);
  assert.match(source, /This account is not authorized for CRM/);
});

test("CRM account lifecycle and original balance are admin-only", () => {
  assert.match(source, /create-account/);
  assert.match(source, /delete-account/);
  assert.match(source, /originalBalanceCents/);
  assert.match(source, /Administrator access required/);
});

test("CRM API exposes operator workflows and private document signing", () => {
  for (const action of ["create-call","create-note","follow-ups","activity","create-document-upload","finalize-document","document-download"]) {
    assert.match(source, new RegExp(action));
  }
  assert.match(source, /createSignedUploadUrl/);
  assert.match(source, /createSignedUrl/);
});
