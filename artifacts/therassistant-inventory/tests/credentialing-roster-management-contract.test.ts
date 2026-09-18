import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const credentialingPage = readFileSync(
  new URL("../src/domains/credentialing/CredentialingPage.tsx", import.meta.url),
  "utf8",
);

const rosterMigration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260918040734_credentialing_roster_actionable_status_alignment.sql",
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
  assert.match(rosterMigration, /drop function if exists public\.create_roster_action_work/i);
  assert.match(rosterMigration, /drop function if exists public\.transition_roster_action/i);
});


test("rejected roster actions remain actionable and status choices follow the transition matrix", () => {
  assert.match(credentialingPage, /const rosterTerminalStatuses = new Set\(\["confirmed", "cancelled"\]\)/);
  assert.match(credentialingPage, /function rosterTransitionOptions/);
  assert.match(credentialingPage, /rejected:[\s\S]*ready[\s\S]*cancelled/);
  assert.doesNotMatch(
    credentialingPage,
    /<option value="not_started">Not Started<\/option>[\s\S]*<option value="cancelled">Cancelled<\/option>/,
  );
});


test("roster cancellation and duplicate guards match the actionable status model", () => {
  assert.match(credentialingPage, /submitted:\s*\["pending", "confirmed", "rejected", "cancelled"\]/);
  assert.match(
    rosterMigration,
    /ra\.status\s+not\s+in\s*\(\s*'confirmed'[\s\S]*'cancelled'[\s\S]*\)/i,
  );
  assert.doesNotMatch(
    rosterMigration,
    /ra\.status\s+not\s+in\s*\(\s*'confirmed'[\s\S]*'rejected'[\s\S]*'cancelled'/i,
  );
});
