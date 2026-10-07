import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PORTAL_ACTIVATE, PORTAL_HOME, PORTAL_LOGIN, isPatientPortalPath, rootPatientPortalDestination } from "../src/domains/portal/routes";

test("staff navigation exposes the actual patient portal in a separate tab",()=>{
  const shell=readFileSync(new URL("../src/components/app-shell.tsx",import.meta.url),"utf8");
  assert.match(shell,/label: "Patient Portal", href: PORTAL_LOGIN/);
  assert.match(shell,/target="_blank" rel="noopener noreferrer"/);
  assert.match(shell,/private window/i);
  assert.match(shell,/invited patient identity/i);
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

test("Site URL fallback chooses patient routes only for matching nonstaff identities", () => {
  const email = { invitedEmail: "patient@example.invalid", authenticatedEmail: "PATIENT@example.invalid" };
  assert.equal(rootPatientPortalDestination({ ...email, status: "invited", hasActiveStaffMembership: false }), PORTAL_ACTIVATE);
  assert.equal(rootPatientPortalDestination({ ...email, status: "active", hasActiveStaffMembership: false }), PORTAL_HOME);
  assert.equal(rootPatientPortalDestination({ ...email, status: "active", hasActiveStaffMembership: true }), null);
  assert.equal(rootPatientPortalDestination({ ...email, authenticatedEmail: "other@example.invalid", status: "invited", hasActiveStaffMembership: false }), null);
  assert.equal(rootPatientPortalDestination({ ...email, status: "revoked", hasActiveStaffMembership: false }), null);
});


test("patient navigation uses real destinations including secure messaging",()=>{
  const nav=readFileSync(new URL("../src/domains/portal/PatientPortalNavigation.tsx",import.meta.url),"utf8");
  const home=readFileSync(new URL("../src/domains/portal/PatientPortalPage.tsx",import.meta.url),"utf8");
  assert.match(nav,/\$\{PORTAL_HOME\}#appointments/);
  assert.match(nav,/\$\{PORTAL_HOME\}#messages/);
  assert.match(nav,/\$\{PORTAL_HOME\}#billing/);
  assert.match(nav,/\$\{PORTAL_HOME\}#profile/);
  assert.match(nav,/Messages/);
  assert.match(nav,/ppn-mobile/);
  assert.match(home,/id="appointments"/);
  assert.match(home,/PatientMessagesPanel/);
  assert.match(home,/id="billing"/);
  assert.match(home,/id="profile"/);
});


test("portal home uses the same branded shell as journal and check-in", () => {
  const home=readFileSync(new URL("../src/domains/portal/PatientPortalPage.tsx",import.meta.url),"utf8");
  assert.match(home,/className="pj-app ppn-home-page"/);
  assert.match(home,/className="pj-topbar"/);
  assert.match(home,/PatientPortalNavigation active="home"/);
  assert.match(home,/className="pj-layout ppn-home-layout"/);
});

test("portal home presents one progressive arrival action per appointment",()=>{
  const home=readFileSync(new URL("../src/domains/portal/PatientPortalPage.tsx",import.meta.url),"utf8");
  assert.match(home,/const arrivalStep = checkedIn \? null : arrived \? "checked_in" : onMyWay \? "arrived" : "on_my_way"/);
  assert.match(home,/const arrivalLabel = checkedIn \? "Checked In ✓" : arrived \? "Check In" : onMyWay \? "I Arrived" : "On My Way"/);
});


test("portal appointments expose staff-routed reschedule and cancellation requests",()=>{
  const home=readFileSync(new URL("../src/domains/portal/PatientPortalPage.tsx",import.meta.url),"utf8");
  const repository=readFileSync(new URL("../src/domains/portal/repository.ts",import.meta.url),"utf8");
  assert.match(home,/Request Reschedule/);
  assert.match(home,/Request Cancellation/);
  assert.match(home,/appointment does not change until the practice confirms/i);
  assert.match(repository,/portal_submit_schedule_change/);
  assert.doesNotMatch(repository,/update.*appointments/i);
});
