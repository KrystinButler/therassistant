type MoneyRow = Record<string, unknown>;

export type BillingHubInput = {
  charges: MoneyRow[];
  claims: MoneyRow[];
  payments: MoneyRow[];
  denials: MoneyRow[];
  appeals: MoneyRow[];
  insuranceAr: MoneyRow[];
  patientAr: MoneyRow[];
  variances: MoneyRow[];
  recoveryItems: MoneyRow[];
};

export type BillingHubMetric = {
  count: number;
  amountCents: number;
};

export type BillingHubSummary = {
  readyCharges: BillingHubMetric;
  claimsNeedAction: BillingHubMetric;
  unappliedPayments: BillingHubMetric;
  insuranceAr: BillingHubMetric;
  patientAr: BillingHubMetric;
  denials: BillingHubMetric;
  appeals: BillingHubMetric;
  underpayments: BillingHubMetric;
  recovery: BillingHubMetric;
};

function sum(rows: MoneyRow[], field: string) {
  return rows.reduce((total, row) => total + Number(row[field] ?? 0), 0);
}

function metric(rows: MoneyRow[], field: string): BillingHubMetric {
  return { count: rows.length, amountCents: sum(rows, field) };
}

export function isActiveArClaimStatus(status: unknown) {
  return !["voided", "reversed"].includes(String(status ?? ""));
}

function isClaimsOwnedStatus(status: unknown) {
  return ["submitted", "accepted", "partially_paid"].includes(String(status ?? ""));
}

export function buildBillingHubSummary(input: BillingHubInput): BillingHubSummary {
  const readyCharges = input.charges.filter((row) => row.charge_status === "ready_for_claim");
  const claimsOwnedInsuranceAr = input.insuranceAr.filter((row) =>
    isClaimsOwnedStatus(row.claim_status) && Number(row.openBalanceCents ?? 0) > 0,
  );
  const unappliedPayments = input.payments
    .filter((row) => ["unapplied", "partially_applied"].includes(String(row.payment_status ?? "")))
    .map((row) => ({
      ...row,
      unappliedCents: Number(row.unappliedCents ?? row.amount_cents ?? 0),
    }));
  const activeDenials = input.denials.filter((row) =>
    !["resolved", "resolved_paid", "resolved_writeoff", "closed"].includes(String(row.denial_status ?? "")),
  );
  const denialsById = new Map(
    input.denials
      .filter((row) => Boolean(row.id))
      .map((row) => [String(row.id), row]),
  );
  const activeAppeals = input.appeals
    .filter((row) => !["approved", "denied", "partially_approved", "withdrawn", "closed"].includes(String(row.appeal_status ?? "")))
    .map((row) => {
      const denialId = String(row.denial_id ?? "");
      return {
        ...row,
        amount_cents: Number(
          row.amount_cents ?? (denialId ? denialsById.get(denialId)?.amount_cents : 0) ?? 0,
        ),
      };
    });
  const variances = input.variances.filter((row) => Number(row.varianceCents ?? 0) > 0);
  const activeRecovery = input.recoveryItems.filter((row) =>
    !["reversed", "voided"].includes(String(row.adjustment_status ?? "")),
  );

  return {
    readyCharges: metric(readyCharges, "charge_amount_cents"),
    claimsNeedAction: metric(claimsOwnedInsuranceAr, "openBalanceCents"),
    unappliedPayments: metric(unappliedPayments, "unappliedCents"),
    insuranceAr: metric(claimsOwnedInsuranceAr, "openBalanceCents"),
    patientAr: metric(input.patientAr, "openBalanceCents"),
    denials: metric(activeDenials, "amount_cents"),
    appeals: metric(activeAppeals, "amount_cents"),
    underpayments: metric(variances, "varianceCents"),
    recovery: metric(activeRecovery, "amount_cents"),
  };
}
