import test from "node:test";
import assert from "node:assert/strict";

import { joinPatientLedger } from "../src/domains/patients/patient-ledger";

test("patient ledger shows its account, source and fiscal period without summing both sides", () => {
  const result = joinPatientLedger(
    [
      { id: "entry-1", ledger_transaction_id: "txn-1", ledger_account_id: "account-1", side: "debit", amount_cents: 9000 },
      { id: "entry-2", ledger_transaction_id: "txn-1", ledger_account_id: "account-2", side: "credit", amount_cents: 9000 },
      { id: "entry-3", ledger_transaction_id: "txn-2", ledger_account_id: "account-1", side: "debit", amount_cents: 1000 },
    ],
    [
      { id: "txn-1", source_type: "payment", accounting_period_id: "period-1" },
      { id: "txn-2", source_type: "historical_import", accounting_period_id: null },
    ],
    [
      { id: "account-1", account_name: "Cash" },
      { id: "account-2", account_name: "Receivables" },
    ],
    [{ id: "period-1", period_name: "October 2026", status: "open" }],
  );
  assert.equal(result.length, 3);
  assert.deepEqual(result.map((row) => [row.accountName, row.periodName, row.sourceType]), [
    ["Cash", "October 2026", "payment"],
    ["Receivables", "October 2026", "payment"],
    ["Cash", "Unassigned", "historical_import"],
  ]);
});
