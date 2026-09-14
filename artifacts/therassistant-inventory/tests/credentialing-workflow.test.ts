import test from "node:test";
import assert from "node:assert/strict";

import {
  availableEnrollmentActions,
  buildCredentialingWorkItem,
  buildEnrollmentStatusHistory,
  buildProviderCredentialingView,
  revalidationState,
  shouldOpenRevalidationWork,
} from "../src/domains/credentialing/workflow.ts";

test("submitted enrollment offers approval and denial actions", () => {
  assert.deepEqual(
    availableEnrollmentActions("submitted").map((action) => action.nextStatus),
    ["approved", "denied"],
  );
});

test("approved enrollment offers revalidation and termination actions", () => {
  assert.deepEqual(
    availableEnrollmentActions("approved").map((action) => action.nextStatus),
    ["needs_revalidation", "terminated"],
  );
});

test("approved enrollment due within 90 days is due soon", () => {
  assert.equal(
    revalidationState(
      { enrollment_status: "approved", revalidation_due_date: "2026-11-30" },
      new Date("2026-09-14T12:00:00Z"),
    ),
    "due_soon",
  );
});

test("approved enrollment past revalidation date is overdue", () => {
  assert.equal(
    revalidationState(
      { enrollment_status: "approved", revalidation_due_date: "2026-09-01" },
      new Date("2026-09-14T12:00:00Z"),
    ),
    "overdue",
  );
});

test("revalidation work opens for explicit revalidation or an approaching approved deadline", () => {
  const today = new Date("2026-09-14T12:00:00Z");
  assert.equal(
    shouldOpenRevalidationWork(
      { enrollment_status: "needs_revalidation", revalidation_due_date: "2026-12-31" },
      today,
    ),
    true,
  );
  assert.equal(
    shouldOpenRevalidationWork(
      { enrollment_status: "approved", revalidation_due_date: "2026-11-30" },
      today,
    ),
    true,
  );
  assert.equal(
    shouldOpenRevalidationWork(
      { enrollment_status: "approved", revalidation_due_date: "2027-09-14" },
      today,
    ),
    false,
  );
});

test("status transition produces enrollment history payload", () => {
  assert.deepEqual(
    buildEnrollmentStatusHistory({
      tenantId: "tenant-1",
      enrollmentId: "enrollment-1",
      oldStatus: "submitted",
      newStatus: "approved",
      reason: "Approval received from payer",
    }),
    {
      tenant_id: "tenant-1",
      target_type: "provider_payer_enrollment",
      target_id: "enrollment-1",
      old_status: "submitted",
      new_status: "approved",
      reason: "Approval received from payer",
    },
  );
});

test("revalidation work item is provider-scoped and payer-specific", () => {
  assert.deepEqual(
    buildCredentialingWorkItem({
      tenantId: "tenant-1",
      providerId: "provider-1",
      payerName: "Aetna",
      dueDate: "2026-11-30",
      state: "due_soon",
    }),
    {
      tenant_id: "tenant-1",
      workqueue_type: "credentialing_issue",
      workqueue_status: "open",
      priority: "high",
      source_object_type: "provider",
      source_object_id: "provider-1",
      title: "Aetna revalidation due soon",
      description: "Provider revalidation is due 2026-11-30.",
      due_date: "2026-11-30",
    },
  );
});

test("Provider 360 credentialing model resolves payer names and revalidation state", () => {
  const result = buildProviderCredentialingView({
    providerId: "provider-1",
    identifiers: [
      { id: "identifier-1", provider_id: "provider-1", identifier_type: "caqh", identifier_value: "12345678", payer_id: null },
      { id: "identifier-2", provider_id: "provider-2", identifier_type: "medicaid", identifier_value: "999", payer_id: null },
    ],
    enrollments: [
      { id: "enrollment-1", provider_id: "provider-1", payer_id: "payer-1", enrollment_status: "approved", revalidation_due_date: "2026-11-30" },
    ],
    payers: [{ id: "payer-1", name: "Aetna" }],
    today: new Date("2026-09-14T12:00:00Z"),
  });

  assert.equal(result.identifiers.length, 1);
  assert.equal(result.enrollments.length, 1);
  assert.equal(result.enrollments[0].payerName, "Aetna");
  assert.equal(result.enrollments[0].revalidationState, "due_soon");
});
