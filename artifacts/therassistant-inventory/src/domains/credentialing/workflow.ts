export type EnrollmentStatus =
  | "not_started"
  | "in_progress"
  | "submitted"
  | "approved"
  | "denied"
  | "terminated"
  | "expired"
  | "needs_revalidation"
  | "unknown";

export type EnrollmentAction = {
  label: string;
  nextStatus: EnrollmentStatus;
};

export type RevalidationState =
  | "not_applicable"
  | "current"
  | "due_soon"
  | "overdue";

const actionsByStatus: Record<EnrollmentStatus, EnrollmentAction[]> = {
  not_started: [{ label: "Start Enrollment", nextStatus: "in_progress" }],
  in_progress: [{ label: "Mark Submitted", nextStatus: "submitted" }],
  submitted: [
    { label: "Approve", nextStatus: "approved" },
    { label: "Deny", nextStatus: "denied" },
  ],
  approved: [
    { label: "Needs Revalidation", nextStatus: "needs_revalidation" },
    { label: "Terminate", nextStatus: "terminated" },
  ],
  denied: [{ label: "Restart Enrollment", nextStatus: "in_progress" }],
  terminated: [{ label: "Restart Enrollment", nextStatus: "in_progress" }],
  expired: [{ label: "Start Revalidation", nextStatus: "in_progress" }],
  needs_revalidation: [{ label: "Start Revalidation", nextStatus: "in_progress" }],
  unknown: [{ label: "Start Enrollment", nextStatus: "in_progress" }],
};

export function availableEnrollmentActions(status: EnrollmentStatus): EnrollmentAction[] {
  return actionsByStatus[status] ?? [];
}

export function revalidationState(
  enrollment: {
    enrollment_status: EnrollmentStatus;
    revalidation_due_date?: string | null;
  },
  today = new Date(),
  warningDays = 90,
): RevalidationState {
  if (!enrollment.revalidation_due_date) return "not_applicable";
  if (!["approved", "needs_revalidation"].includes(enrollment.enrollment_status)) {
    return "not_applicable";
  }

  const due = new Date(`${enrollment.revalidation_due_date}T00:00:00Z`);
  const current = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const daysUntilDue = Math.floor((due.getTime() - current.getTime()) / 86_400_000);

  if (daysUntilDue < 0) return "overdue";
  if (daysUntilDue <= warningDays) return "due_soon";
  return "current";
}

export function buildEnrollmentStatusHistory(input: {
  tenantId: string;
  enrollmentId: string;
  oldStatus: EnrollmentStatus;
  newStatus: EnrollmentStatus;
  reason?: string | null;
}) {
  return {
    tenant_id: input.tenantId,
    target_type: "provider_payer_enrollment",
    target_id: input.enrollmentId,
    old_status: input.oldStatus,
    new_status: input.newStatus,
    reason: input.reason ?? null,
  };
}

export function buildCredentialingWorkItem(input: {
  tenantId: string;
  providerId: string;
  payerName: string;
  dueDate: string;
  state: "due_soon" | "overdue";
}) {
  const overdue = input.state === "overdue";
  return {
    tenant_id: input.tenantId,
    workqueue_type: "credentialing_issue",
    workqueue_status: "open",
    priority: overdue ? "urgent" : "high",
    source_object_type: "provider",
    source_object_id: input.providerId,
    title: `${input.payerName} revalidation ${overdue ? "overdue" : "due soon"}`,
    description: `Provider revalidation is due ${input.dueDate}.`,
    due_date: input.dueDate,
  };
}
