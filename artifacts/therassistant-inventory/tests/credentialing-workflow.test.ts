import test from "node:test";
import assert from "node:assert/strict";

import {
  availableEnrollmentActions,
  buildCredentialingWorkItem,
  buildEnrollmentStatusHistory,
  revalidationState,
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
