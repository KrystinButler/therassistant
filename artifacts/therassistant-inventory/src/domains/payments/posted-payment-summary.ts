/** Cash posted to the ledger; historical reversed/voided rows remain visible but are not cash. */
export function summarizePostedPayments(payments: Record<string, unknown>[]) {
  const posted = payments.filter((payment) =>
    ["posted", "partially_applied"].includes(String(payment.payment_status ?? ""))
    && Boolean(payment.posted_at),
  );
  return {
    totalCents: posted.reduce((sum, payment) => sum + Number(payment.amount_cents ?? 0), 0),
    count: posted.length,
  };
}
