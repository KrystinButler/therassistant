import test from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";
const app=readFileSync(new URL("../src/App.tsx",import.meta.url),"utf8");
const shell=readFileSync(new URL("../src/components/app-shell.tsx",import.meta.url),"utf8");
const gate=readFileSync(new URL("../src/domains/portal/PatientPortalGate.tsx",import.meta.url),"utf8");
const view=readFileSync(new URL("../src/domains/portal/StaffPortalPreviewPage.tsx",import.meta.url),"utf8");
test("staff portal preview lives behind StaffGate and never reads PHI or patient RPC",()=>{
 assert.match(app,/<Route path="\/portal-preview"><StaffPortalPreviewPage/);
 assert.match(shell,/label: "Portal Preview", href: "\/portal-preview"/);
 assert.match(view,/STAFF DESIGN PREVIEW · SYNTHETIC DATA/);
 assert.doesNotMatch(view,/getMyPortalContext|portalRpc|getPatientPortalData/);
 assert.match(view,/private browser window/);
});
test("patient portal gate explains separate staff and patient identities",()=>{
 assert.match(gate,/showPreview/);
 assert.match(gate,/Open Staff Portal Preview/);
 assert.match(gate,/Patient portal access requires a separately invited patient identity/);
});

test("admin can invite a separate synthetic patient for actual portal testing",()=>{
 assert.match(view,/invitePatientPortal/);
 assert.match(view,/Create \/ Invite Synthetic Test Patient/);
 assert.match(view,/practice_admin/);
 assert.match(view,/synthetic: true/);
 assert.doesNotMatch(view,/portalRpc|getPatientPortalData|getMyPortalContext/);
});
