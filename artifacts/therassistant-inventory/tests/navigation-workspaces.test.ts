import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKSPACES,
  getVisibleWorkspaces,
  getWorkspaceForPath,
  getActiveChildForPath,
  getWorkspaceContext,
  toggleExpandedWorkspace,
} from "../src/navigation/workspaces.ts";

const workspaceId = (path: string) => getWorkspaceForPath(path)?.id;
const childLabel = (path: string) => getActiveChildForPath(path)?.label;

test("canonical workspace order matches the ChatGPT Therassistant site", () => {
  assert.deepEqual(
    WORKSPACES.map((workspace) => workspace.label),
    [
      "Overview",
      "Care delivery",
      "Revenue cycle",
      "Operations",
      "Insights",
      "Client experience",
      "Help center",
      "Settings",
    ],
  );
});

test("Help center remains canonical but is not rendered until a route exists", () => {
  const help = WORKSPACES.find((workspace) => workspace.id === "help-center");
  assert.equal(help?.renderInSidebar, false);
  assert.equal(help?.primaryHref, undefined);
  assert.equal(getVisibleWorkspaces().some((workspace) => workspace.id === "help-center"), false);
});

test("workspace metadata keeps safe primary destinations and future visibility fields", () => {
  assert.equal(WORKSPACES.find((workspace) => workspace.id === "overview")?.primaryHref, "/");
  assert.equal(WORKSPACES.find((workspace) => workspace.id === "revenue-cycle")?.primaryHref, "/billing");
  assert.equal(WORKSPACES.find((workspace) => workspace.id === "settings")?.primaryHref, "/administration");
  for (const workspace of WORKSPACES) assert.equal(workspace.visibility.mode, "all");
});

test("primary routes map to the owning workspace", () => {
  const cases: Array<[string, string]> = [
    ["/", "overview"],
    ["/work-center", "overview"],
    ["/clients", "care-delivery"],
    ["/schedule", "care-delivery"],
    ["/clinical", "care-delivery"],
    ["/eligibility", "care-delivery"],
    ["/billing", "revenue-cycle"],
    ["/billing/charges", "revenue-cycle"],
    ["/charges", "revenue-cycle"],
    ["/claims", "revenue-cycle"],
    ["/claims/submission", "revenue-cycle"],
    ["/claims/follow-up", "revenue-cycle"],
    ["/payments", "revenue-cycle"],
    ["/ar-denials", "revenue-cycle"],
    ["/providers", "operations"],
    ["/credentialing", "operations"],
    ["/payers-contracts", "operations"],
    ["/administration/imports", "operations"],
    ["/reports", "insights"],
    ["/journal", "client-experience"],
    ["/administration", "settings"],
    ["/administration/database-inventory", "settings"],
  ];

  for (const [path, expected] of cases) assert.equal(workspaceId(path), expected, path);
});

test("contextual record routes keep their owning workspace active", () => {
  const cases: Array<[string, string]> = [
    ["/clients/11111111-1111-4111-8111-111111111111", "care-delivery"],
    ["/schedule/22222222-2222-4222-8222-222222222222", "care-delivery"],
    ["/encounters/33333333-3333-4333-8333-333333333333", "care-delivery"],
    ["/clinical/golden-thread/44444444-4444-4444-8444-444444444444", "care-delivery"],
    ["/claims/55555555-5555-4555-8555-555555555555", "revenue-cycle"],
    ["/providers/66666666-6666-4666-8666-666666666666", "operations"],
    ["/payers/77777777-7777-4777-8777-777777777777", "operations"],
    ["/mailroom/75000000-0000-4000-8000-000000000001", "operations"],
    ["/patient-portal/88888888-8888-4888-8888-888888888888", "client-experience"],
  ];

  for (const [path, expected] of cases) assert.equal(workspaceId(path), expected, path);
});

test("specific children win over broader route prefixes", () => {
  assert.equal(childLabel("/claims/submission"), "Claim Submission / 837P");
  assert.equal(childLabel("/claims/follow-up"), "Claim Follow-Up");
  assert.equal(childLabel("/billing/charges"), "Charge Capture");
  assert.equal(childLabel("/administration/imports"), "Imports / Migration");
  assert.equal(childLabel("/administration/database-inventory"), "Database Inventory");
  assert.equal(childLabel("/payers/payer-1"), "Payers & Contracts");
});

test("patient portal is contextual and not a generic staff child link", () => {
  const workspace = WORKSPACES.find((item) => item.id === "client-experience");
  assert.deepEqual(workspace?.children.map((child) => child.label), ["Journal"]);
  assert.equal(workspaceId("/patient-portal/patient-1"), "client-experience");
  assert.equal(childLabel("/patient-portal/patient-1"), undefined);
});

test("navigation labels never expose ids or raw route fragments", () => {
  const labels = WORKSPACES.flatMap((workspace) => [workspace.label, ...workspace.children.map((child) => child.label)]);
  for (const label of labels) {
    assert.equal(label.includes(":"), false, label);
    assert.equal(/[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(label), false, label);
  }
});

test("workspace context returns both workspace and active child when available", () => {
  const context = getWorkspaceContext("/claims/submission");
  assert.equal(context.workspace?.label, "Revenue cycle");
  assert.equal(context.child?.label, "Claim Submission / 837P");
});

test("accordion toggle allows at most one expanded workspace", () => {
  assert.equal(toggleExpandedWorkspace(null, "overview"), "overview");
  assert.equal(toggleExpandedWorkspace("overview", "revenue-cycle"), "revenue-cycle");
  assert.equal(toggleExpandedWorkspace("revenue-cycle", "revenue-cycle"), null);
});

test("unmapped and retired paths fail soft instead of inventing an owner", () => {
  for (const path of ["/not-a-real-route", "/authorizations", "/medicaid", "/mailroom"]) {
    const context = getWorkspaceContext(path);
    assert.equal(context.workspace, undefined, path);
    assert.equal(context.child, undefined, path);
  }
});

test("contextual record routes may have a workspace without a visible child", () => {
  const portal = getWorkspaceContext("/patient-portal/patient-1");
  assert.equal(portal.workspace?.label, "Client experience");
  assert.equal(portal.child, undefined);

  const encounter = getWorkspaceContext("/encounters/encounter-1");
  assert.equal(encounter.workspace?.label, "Care delivery");
  assert.equal(encounter.child, undefined);
});
