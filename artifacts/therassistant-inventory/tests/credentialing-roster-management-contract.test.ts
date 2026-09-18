import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const credentialingPage = readFileSync(
  new URL("../src/domains/credentialing/CredentialingPage.tsx", import.meta.url),
  "utf8",
);

const rosterMigration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260918000000_credentialing_roster_management_rpcs.sql",
    import.meta.url,
  ),
  "utf8",
);

test("credentialing exposes roster management without a second task system", () => {
  assert.match(credentialingPage, /Roster Management/);
  assert.match(credentialingPage, /tenantSelect\("roster_actions"/);
  assert.match(credentialingPage, /create_roster_action_work/);
  assert.match(credentialingPage, /transition_roster_action/);
  assert.match(credentialingPage, /workqueue_items/);
  assert.doesNotMatch(credentialingPage, /credentialing_issues/);
});

test("roster actions support the payer maintenance operations in the normalized enum", () => {
  for (const action of [
    "add_provider",
    "remove_provider",
    "update_demographics",
    "add_location",
    "remove_location",
    "correct_name",
    "correct_npi",
    "correct_tin",
    "correct_taxonomy",
    "add_product",
    "remove_product",
    "other",
  ]) {
    assert.match(credentialingPage, new RegExp(action));
  }
});

test("roster creation and transition keep workqueue and status history synchronized", () => {
  assert.match(rosterMigration, /create or replace function public\.create_roster_action_work/i);
  assert.match(rosterMigration, /create or replace function public\.transition_roster_action/i);
  assert.match(rosterMigration, /workqueue_type[\s\S]*roster_action/i);
  assert.match(rosterMigration, /source_object_type[\s\S]*roster_action/i);
  assert.match(rosterMigration, /insert into public\.status_history/i);
  assert.match(rosterMigration, /private\.has_tenant_write_access/i);
  assert.match(rosterMigration, /security invoker/i);
});
