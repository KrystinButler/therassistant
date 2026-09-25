import test from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";
const queue=readFileSync(new URL("../src/domains/billing/BillingQueuePage.tsx",import.meta.url),"utf8");
const repo=readFileSync(new URL("../src/domains/billing/repository.ts",import.meta.url),"utf8");
const panel=readFileSync(new URL("../src/domains/billing/BillingResponsibilityPanel.tsx",import.meta.url),"utf8");
test("funding corrections moved out of clinical documentation into billing workqueue",()=>{
 assert.match(queue,/onEditFunding=\{setFundingEncounterId\}/);
 assert.match(queue,/BillingResponsibilityPanel/);
 assert.match(panel,/Existing claims and signed clinical notes are not changed/);
 assert.match(panel,/billingPathLabel\(billingPathForFundingSource\(source\)\)/);
});
test("funding save is tenant-scoped and does not rewrite charges, claims or signatures",()=>{
 assert.match(repo,/updateEncounterFundingForBilling/);
 assert.match(repo,/tenantSelect<DataRow>\("encounters"/);
 assert.match(repo,/tenantUpdate<DataRow>\("encounters"/);
 assert.match(repo,/funding_path|billing_path/);
});
