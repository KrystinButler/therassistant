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

export function buildBillingHubSummary(input: BillingHubInput): BillingHubSummary {
  const readyCharges = input.charges.filter((row) => row.charge_status === "ready_for_claim");
  const claimsNeedAction = input.claims.filter((row) =>
    ["validation_failed", "rejected", "denied"].includes(String(row.claim_status ?? "")),
  );
  const unappliedPayments = input.payments.filter((row) =>
    ["unapplied", "partially_applied"].includes(String(row.payment_status ?? "")),
  );
  const activeDenials = input.denials.filter((row) =>
    !["resolved_paid", "resolved_writeoff", "upheld", "closed"].includes(String(row.denial_status ?? "")),
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
    claimsNeedAction: metric(claimsNeedAction, "total_charge_cents"),
    unappliedPayments: metric(unappliedPayments, "amount_cents"),
    insuranceAr: metric(input.insuranceAr, "openBalanceCents"),
    patientAr: metric(input.patientAr, "openBalanceCents"),
    denials: metric(activeDenials, "amount_cents"),
    appeals: metric(activeAppeals, "amount_cents"),
    underpayments: metric(variances, "varianceCents"),
    recovery: metric(activeRecovery, "amount_cents"),
  };
}
