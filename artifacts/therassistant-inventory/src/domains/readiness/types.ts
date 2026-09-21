export type ReadinessCheckStatus = "pass" | "warn" | "fail";

export type ReadinessCheck = {
  code: string;
  label: string;
  status: ReadinessCheckStatus;
  blocking: boolean;
  message: string;
  action?: string;
};

export type PreSessionReadiness = {
  ready: boolean;
  checks: ReadinessCheck[];
};

export type PreSessionInput = {
  billingType?: string | null;
  policy: { status?: string | null } | null;
  eligibility: { eligibility_status?: string | null; service_date?: string | null } | null;
  providerEnrollmentStatus?: string | null;
  treatmentPlan?: {
    status?: string | null;
    review_due_date?: string | null;
  } | null;
  serviceDate?: string | null;
};
