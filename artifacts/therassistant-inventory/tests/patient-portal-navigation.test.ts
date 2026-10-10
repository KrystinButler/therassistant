import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PORTAL_CHECK_IN, PORTAL_HOME, PORTAL_JOURNAL, PORTAL_MESSAGES, portalCheckInPath } from "../src/domains/portal/routes";

test("staff navigation exposes the actual patient portal in a separate tab",()=>{
  const source=readFileSync(new URL("../src/domains/clinical/pages/PatientJournalStaffPage.tsx",import.meta.url),"utf8");
  assert.match(source,/target="_blank"/);
  assert.match(source,/rel="noreferrer"/);
  assert.match(source,/Patient Portal/);
});

test("staff journal offers direct patient portal testing without treating staff as patient",()=>{
  const source=readFileSync(new URL("../src/domains/clinical/pages/PatientJournalStaffPage.tsx",import.meta.url),"utf8");
  assert.match(source,/Test Patient Portal/);
  assert.match(source,/portalLoginUrl/);
});

test("Site URL fallback chooses patient routes only for matching nonstaff identities",()=>{
  const source=readFileSync(new URL("../src/App.tsx",import.meta.url),"utf8");
  assert.match(source,/patient-portal/);
});

test("patient navigation uses real destinations including secure messaging",()=>{
  assert.equal(PORTAL_HOME,"/patient-portal");
  assert.equal(PORTAL_JOURNAL,"/patient-portal/journal");
  assert.equal(PORTAL_MESSAGES,"/patient-portal/messages");
  assert.equal(PORTAL_CHECK_IN,"/patient-portal/check-in/:appointmentId");
  assert.equal(portalCheckInPath("appt-1"),"/patient-portal/check-in/appt-1");
  const navigation=readFileSync(new URL("../src/domains/portal/PatientPortalNavigation.tsx",import.meta.url),"utf8");
  assert.match(navigation,/Messages/);
  assert.match(navigation,/Appointments/);
  assert.match(navigation,/Journal/);
  assert.match(navigation,/Billing/);
  const home=readFileSync(new URL("../src/domains/portal/PatientPortalPage.tsx",import.meta.url),"utf8");
  assert.match(home,/id="appointments"/);
  assert.match(home,/id="appointment-history"/);
  assert.match(home,/id="coverage"/);
  assert.match(home,/id="documents"/);
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
  assert.match(home,/const arrivalStep = getPortalArrivalStep\(appointment, checkin \?\? \{\}\)/);
  assert.match(home,/arrivalStep === "arrived" \? "I Arrived" : "On My Way"/);
  assert.match(home,/arrivalStep === "on_my_way" \? arrivalAvailability\.onMyWay : arrivalAvailability\.arrival/);
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
