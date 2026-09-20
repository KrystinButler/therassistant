import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(here, "../../../supabase/migrations/202609202005_payment_reversal_ledger_integrity.sql"),
  "utf8",
);

test("payment reversal creates opposite ledger entries for receipt and allocations", () => {
  assert.match(migration, /source_type in \('payment_receipt', 'payment_allocation'\)/);
  assert.match(migration, /when le\.side = 'debit'.*then 'credit'/s);
  assert.match(migration, /'payment_reversal'/);
  assert.match(migration, /v_reversal_id/);
});

test("payment reversal recalculates claim and patient balances", () => {
  assert.match(migration, /recalculate_claim_balance_summary\(v_claim_id\)/);
  assert.match(migration, /recalculate_client_balance_summary\(v_claim\.client_id\)/);
  assert.match(migration, /recalculate_client_balance_summary\(v_payment\.client_id\)/);
});

test("payment reversal remains single-use", () => {
  assert.match(migration, /Payment is already reversed or voided/);
  assert.match(migration, /payment_status = 'reversed'/);
});
