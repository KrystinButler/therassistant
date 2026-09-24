import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildDirectDocumentationDraft } from "../src/domains/encounters/direct-documentation";

const source = readFileSync(new URL("../src/domains/clinical/ClinicalPage.tsx", import.meta.url), "utf8");
const valid = { clientId:"client-1",providerId:"provider-1",serviceType:"Psychotherapy",serviceDate:"2026-09-23",locationType:"telehealth" };

test("direct documentation creates a clinical encounter without inventing an appointment or billing status", () => {
  const draft = buildDirectDocumentationDraft(valid);
  assert.equal(draft.appointment_id, null);
  assert.equal(draft.client_id, "client-1");
  assert.equal(draft.provider_id, "provider-1");
  assert.equal(draft.billing_status, "not_ready");
  assert.equal(draft.encounter_status, "in_progress");
  assert.equal(draft.started_at.slice(0,10), "2026-09-23");
  assert.ok(!("payer_id" in draft));
});
test("direct documentation rejects absent identities, incorrect dates and future visits", () => {
  assert.throws(() => buildDirectDocumentationDraft({...valid,clientId:""}), /Patient and rendering/);
  assert.throws(() => buildDirectDocumentationDraft({...valid,providerId:""}), /Patient and rendering/);
  assert.throws(() => buildDirectDocumentationDraft({...valid,serviceDate:"2026-02-30"}), /actual calendar/);
  assert.throws(() => buildDirectDocumentationDraft({...valid,serviceDate:"2099-12-01"}), /future service/);
});
test("Clinical Documentation exposes new note workflow and retains unscheduled records in its queue", () => {
  assert.match(source,/Create Documentation/);
  assert.match(source,/createUnscheduledEncounter/);
  assert.match(source,/!encounter.appointment_id/);
  assert.match(source,/startEncounter\(selectedVisit.id\)/);
  assert.match(source,/encounter-progress-note-editor/);
});
