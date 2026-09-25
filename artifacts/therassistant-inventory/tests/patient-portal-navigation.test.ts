import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PORTAL_LOGIN, isPatientPortalPath } from "../src/domains/portal/routes";

test("staff navigation exposes the actual patient portal in a separate tab",()=>{
  const shell=readFileSync(new URL("../src/components/app-shell.tsx",import.meta.url),"utf8");
  assert.match(shell,/label: "Patient Portal", href: PORTAL_LOGIN/);
  assert.match(shell,/target="_blank" rel="noopener noreferrer"/);
  assert.match(shell,/private browser session/);
  assert.equal(PORTAL_LOGIN,"/patient-portal/login");
  assert.equal(isPatientPortalPath(PORTAL_LOGIN),true);
});
test("staff journal offers direct patient portal testing without treating staff as patient",()=>{
  const page=readFileSync(new URL("../src/domains/journal/JournalPage.tsx",import.meta.url),"utf8");
  const gate=readFileSync(new URL("../src/domains/portal/PatientPortalGate.tsx",import.meta.url),"utf8");
  assert.match(page,/Open Patient Portal/);
  assert.match(page,/private browser window/);
  assert.match(page,/href=\{PORTAL_LOGIN\}/);
  assert.match(gate,/getMyPortalContext\(\)/);
  assert.match(gate,/This account is not linked to an active patient portal invitation/);
});
