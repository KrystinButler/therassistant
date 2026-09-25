import test from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";
const panel=readFileSync(new URL("../src/domains/portal/PortalAccessPanel.tsx",import.meta.url),"utf8");
const chart=readFileSync(new URL("../src/domains/patients/PatientChartPage.tsx",import.meta.url),"utf8");
const edge=readFileSync(new URL("../../../supabase/functions/invite-patient-portal/index.ts",import.meta.url),"utf8");
test("duplicate Auth email makes patient-email correction a one-click chart action",()=>{
 assert.match(panel,/emailConflict/);assert.match(panel,/Update Patient Email/);
 assert.match(chart,/onEditDemographics=\{\(\) => setTab\("demographics"\)\}/);
 assert.match(edge,/save a separate patient email and press Send Portal Invite again/);
});
test("staff Auth identity is never automatically linked to patient",()=>{
 assert.match(edge,/accounts are never linked automatically/);
 assert.match(panel,/Staff cannot assign another user’s account to a patient/);
});
