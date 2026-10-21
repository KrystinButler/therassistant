import { tenantSelect, type Row } from "../../lib/tenant-data-client";

type RecordRow = Row & { id: string };
type PatientLedgerRow = RecordRow & {
  accountName: string;
  periodName: string;
  periodStatus: string;
  sourceType: string;
};

/** Keep both sides of the journal visible; never add them together as patient A/R. */
export function joinPatientLedger(
  entries: ReadonlyArray<RecordRow>,
  transactions: ReadonlyArray<RecordRow>,
  accounts: ReadonlyArray<RecordRow>,
  periods: ReadonlyArray<RecordRow>,
): PatientLedgerRow[] {
  const transactionById = new Map(transactions.map((row) => [row.id, row]));
  const accountById = new Map(accounts.map((row) => [row.id, row]));
  const periodById = new Map(periods.map((row) => [row.id, row]));
  return entries.map((entry) => {
    const transaction = transactionById.get(String(entry.ledger_transaction_id ?? ""));
    const account = accountById.get(String(entry.ledger_account_id ?? ""));
    const period = periodById.get(String(transaction?.accounting_period_id ?? ""));
    return {
      ...entry,
      accountName: String(account?.account_name ?? "Unknown account"),
      periodName: String(period?.period_name ?? "Unassigned"),
      periodStatus: String(period?.status ?? "unassigned"),
      sourceType: String(transaction?.source_type ?? "—"),
    };
  });
}

export async function getPatientAccountingActivity(clientId: string) {
  if (!clientId) throw new Error("Patient ID is required.");
  const [entries, history, accounts, periods] = await Promise.all([
    tenantSelect<RecordRow>("ledger_entries", { client_id: `eq.${clientId}`, order: "posting_date.desc,created_at.desc", limit: "150" }),
    tenantSelect<RecordRow>("historical_transactions", { client_id: `eq.${clientId}`, order: "transaction_date.desc,created_at.desc", limit: "100" }),
    tenantSelect<RecordRow>("ledger_accounts", { order: "account_code.asc" }),
    tenantSelect<RecordRow>("accounting_periods", { order: "start_date.desc" }),
  ]);
  const ids = [...new Set(entries.map((row) => String(row.ledger_transaction_id ?? "")).filter(Boolean))];
  const groups: string[][] = [];
  for (let index = 0; index < ids.length; index += 40) groups.push(ids.slice(index, index + 40));
  const transactions = (await Promise.all(groups.map((group) =>
    tenantSelect<RecordRow>("ledger_transactions", { id: `in.(${group.join(",")})`, limit: String(group.length) }),
  ))).flat();
  return { entries: joinPatientLedger(entries, transactions, accounts, periods), history };
}
