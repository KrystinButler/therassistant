export type Phase3BillingScenario = {
  code:
    | "claim_rejection_resubmission"
    | "denial_appeal"
    | "contract_underpayment"
    | "recoupment_recovery"
    | "unapplied_payment_reversal"
    | "credentialing_writeoff";
  title: string;
  demoId: string;
  claimId: string;
  detail: string;
  href: string;
  synthetic: true;
};

export const phase3BillingScenarios: Phase3BillingScenario[] = [
  {
    code: "claim_rejection_resubmission",
    title: "Rejected Claim Corrected and Resubmitted",
    demoId: "P3-REJECT-001",
    claimId: "62000000-0000-4000-8000-000000000001",
    detail: "Initial clearinghouse rejection is preserved, a corrected submission is sent, and the claim reaches accepted status.",
    href: "/claims/62000000-0000-4000-8000-000000000001",
    synthetic: true,
  },
  {
    code: "denial_appeal",
    title: "Workable Denial Under Appeal",
    demoId: "P3-APPEAL-001",
    claimId: "62000000-0000-4000-8000-000000000002",
    detail: "Authorization denial is linked to an active appeal deadline and Work Center follow-up.",
    href: "/claims/62000000-0000-4000-8000-000000000002",
    synthetic: true,
  },
  {
    code: "contract_underpayment",
    title: "Contract Underpayment Variance",
    demoId: "P3-UNDERPAY-001",
    claimId: "62000000-0000-4000-8000-000000000003",
    detail: "Payer allowed amount is below the active fee schedule, leaving a recoverable contract variance.",
    href: "/claims/62000000-0000-4000-8000-000000000003",
    synthetic: true,
  },
  {
    code: "recoupment_recovery",
    title: "Payer Recoupment Recovery",
    demoId: "P3-RECOUP-001",
    claimId: "62000000-0000-4000-8000-000000000004",
    detail: "A posted recoupment is linked to recovery review work without deleting the original payment history.",
    href: "/ar-denials?tab=recovery",
    synthetic: true,
  },
  {
    code: "unapplied_payment_reversal",
    title: "Payment Allocation Reversed",
    demoId: "P3-REVERSAL-001",
    claimId: "62000000-0000-4000-8000-000000000005",
    detail: "A payment that moved through unapplied/partial allocation retains its allocation and reversal audit trail.",
    href: "/payments",
    synthetic: true,
  },
  {
    code: "credentialing_writeoff",
    title: "Credentialing Denial Write-Off",
    demoId: "P3-CRED-WO-001",
    claimId: "62000000-0000-4000-8000-000000000006",
    detail: "Credentialing denial follows the configured non-workable write-off policy instead of entering the appeal queue.",
    href: "/claims/62000000-0000-4000-8000-000000000006",
    synthetic: true,
  },
];
