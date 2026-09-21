# Brandon CRM migration review

Date: 2026-09-21

## Source account

The initial CRM account represents **Inner Space Psychiatry PLLC / Brandon D. Burelle, PMHNP-BC**.

- Original collection principal: **$11,081.25**
- The CRM original balance intentionally excludes previously calculated accrued interest.
- Historical unpaid invoices: BDB-0003, BDB-0004, BDB-0005, BDB-0006.
- Internal CRM account number: CRM-000001 (system-assigned; not presented as a historical debtor account number).

## Existing Payment Desk transaction review

Two transactions existed before CRM linkage.

| Transaction ID | Customer | Amount | Result | Link to Brandon? | Reason |
|---|---|---:|---|---|---|
| 0587965b-151e-4aa3-9cd8-568baf89d2fc | Brandon Burelle | $1.00 | COMPLETED | **No** | Sandbox test transaction using test card ending 1111. It must not reduce the real collection balance. |
| 85ec32fe-b19c-4706-992d-32f7b37fd823 | Krystin Butler | $1.00 | COMPLETED | **No** | Explicit test transaction and not Brandon's payment. |

No existing transaction IDs are linked by the seed migration.

## Derived starting balance

Because no production payment is linked, Brandon's CRM starts at **$11,081.25**.
