import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const app=readFileSync(new URL("../src/App.tsx",import.meta.url),"utf8");
const gate=readFileSync(new URL("../src/domains/crm/CrmGate.tsx",import.meta.url),"utf8");
test("CRM routes are intercepted before EHR tenant routing",()=>{assert.match(app,/location\.startsWith\("\/crm\/"/);assert.match(app,/CrmGate/);});
test("CRM gate uses auth but not EHR tenant context",()=>{assert.match(gate,/useAuth/);assert.doesNotMatch(gate,/TenantProvider|useTenant|tenant-context/);});
test("Payment Desk compatibility is not redirected into EHR",()=>{assert.doesNotMatch(app,/Redirect to="\/payment-desk"/);});
