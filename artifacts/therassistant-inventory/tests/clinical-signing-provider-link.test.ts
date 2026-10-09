import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../supabase/migrations/20261009044611_auto_link_clinician_during_note_signing.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

test("sign_encounter_note securely establishes a missing clinician/provider link inside the signing transaction", () => {
  const clinicianGate = migration.indexOf("role='clinician'");
  const autoLink = migration.indexOf(
    "perform public.link_current_user_to_provider(v_note.provider_id);",
  );
  const finalLinkGuard = migration.indexOf(
    "raise exception 'A linked clinician account is required to sign this note'",
    autoLink,
  );
  const signatureInsert = migration.indexOf(
    "insert into public.clinical_note_signatures",
    autoLink,
  );

  assert.ok(clinicianGate >= 0, "Signing must still require the Clinician role.");
  assert.ok(autoLink > clinicianGate, "Auto-link must run only after the Clinician role gate.");
  assert.ok(finalLinkGuard > autoLink, "Signing must re-check the active provider link after auto-link.");
  assert.ok(signatureInsert > finalLinkGuard, "No signature may be inserted until provider identity is linked.");
});

test("signing delegates first-time identity checks to the hardened provider-link RPC", () => {
  assert.match(
    migration,
    /perform public\.link_current_user_to_provider\(v_note\.provider_id\);/,
  );
  assert.doesNotMatch(
    migration,
    /insert into public\.provider_user_links/,
    "Signing must not bypass the hardened provider-link function with a direct insert.",
  );
  assert.doesNotMatch(migration, /security definer/i);
});
