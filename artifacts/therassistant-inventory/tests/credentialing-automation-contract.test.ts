import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const credentialingPage = readFileSync(
  new URL("../src/domains/credentialing/CredentialingPage.tsx", import.meta.url),
  "utf8",
);

const automationMigration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260918042710_credentialing_operational_automation.sql",
    import.meta.url,
  ),
  "utf8",
);

test("credentialing loads operational automation before reading workqueues", () => {
  assert.match(credentialingPage, /sync_credentialing_operational_work/);
  assert.match(credentialingPage, /sync_provider_revalidation_work/);
  assert.match(
    credentialingPage,
    /Promise\.allSettled\([\s\S]*sync_provider_revalidation_work[\s\S]*sync_credentialing_operational_work/,
  );
});

test("credentialing automation creates the planned universal workqueue actions", () => {
  assert.match(automationMigration, /create or replace function public\.sync_credentialing_operational_work/i);
  assert.match(automationMigration, /security invoker/i);
  assert.match(automationMigration, /private\.has_tenant_write_access/i);

  for (const expected of [
    "Credentialing: Payer Follow-Up",
    "Credentialing: Additional Information Requested",
    "Credentialing: Approval Details Needed",
    "Credentialing: Verify Payer Roster",
    "Credentialing: Verify Payer Directory",
    "Credentialing: Recredentialing Due",
  ]) {
    assert.match(automationMigration, new RegExp(expected));
  }

  assert.match(automationMigration, /credential_expiration/);
  assert.match(automationMigration, /provider_credential/);
  assert.match(automationMigration, /remove_provider/);
  assert.match(automationMigration, /roster_action/);
  assert.doesNotMatch(automationMigration, /credentialing_issues/);
});

test("automation is idempotent instead of inserting duplicate active work", () => {
  assert.match(automationMigration, /not exists[\s\S]*workqueue_items/i);
  assert.match(automationMigration, /not exists[\s\S]*roster_actions/i);
  assert.match(automationMigration, /revoke all on function public\.sync_credentialing_operational_work/i);
});


const automationHardeningMigration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260918043043_credentialing_operational_automation_hardening.sql",
    import.meta.url,
  ),
  "utf8",
);

test("payer follow-up automation reuses active follow-up work instead of duplicating renamed tasks", () => {
  assert.match(automationHardeningMigration, /update public\.workqueue_items/i);
  assert.match(automationHardeningMigration, /workqueue_status not in \('completed', 'cancelled'\)/i);
  assert.match(automationHardeningMigration, /Additional Information Requested/);
  assert.match(automationHardeningMigration, /Approval Details Needed/);
  assert.match(automationHardeningMigration, /requested_change->>'automation'/);
  assert.match(automationHardeningMigration, /provider_terminated/);
});
