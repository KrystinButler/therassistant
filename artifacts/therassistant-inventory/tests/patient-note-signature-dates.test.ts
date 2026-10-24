import test from "node:test";
import assert from "node:assert/strict";
import { attachClinicalSignatureDates } from "../src/domains/patients/note-signatures.ts";

test("the patient Notes table displays the actual server-signed timestamp", () => {
  const notes = [
    { id: "note-1", note_status: "signed", service_date: "2026-10-01" },
    { id: "note-2", note_status: "draft", service_date: "2026-10-02" },
  ];
  const result = attachClinicalSignatureDates(notes, [
    { clinical_note_id: "note-1", signed_at: "2026-10-03T18:30:00Z" },
  ]);
  assert.equal(result[0].signed_at, "2026-10-03T18:30:00Z");
  assert.equal(result[1].signed_at, undefined);
});

test("signature dates cannot be attached to unrelated patient notes", () => {
  const result = attachClinicalSignatureDates([{ id: "note-1" }], [
    { clinical_note_id: "another-note", signed_at: "2026-10-03T18:30:00Z" },
  ]);
  assert.equal(result[0].signed_at, undefined);
});
