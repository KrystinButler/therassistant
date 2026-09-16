import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeTenantSettings,
  validateDiagnosisCode,
  validateIntervention,
  validateLocation,
  validateServiceCode,
} from "../src/domains/settings/settings-validation";

test("tenant settings patch preserves unrelated namespaces and existing namespace keys", () => {
  const current = {
    demo: true,
    client_portal: { enabled: true, allow_journal: true },
    unrelated: { keep: 1 },
  };

  const next = mergeTenantSettings(current, {
    client_portal: { balance_limit_cents: 5000 },
  });

  assert.deepEqual(next.unrelated, { keep: 1 });
  assert.equal(next.client_portal?.enabled, true);
  assert.equal(next.client_portal?.allow_journal, true);
  assert.equal(next.client_portal?.balance_limit_cents, 5000);
  assert.notEqual(next, current);
});

test("tenant settings patch rejects unknown namespaces", () => {
  assert.throws(
    () => mergeTenantSettings({}, { unsafe_namespace: { enabled: true } } as never),
    /Unsupported settings namespace/,
  );
});

test("service code validation trims values and rejects invalid amounts", () => {
  const valid = validateServiceCode({
    code: " 90837 ",
    description: " Psychotherapy, 60 minutes ",
    default_fee_cents: 15000,
    default_units: 1,
    default_duration_minutes: 60,
    default_place_of_service: "11",
    active: true,
    sort_order: 0,
  });

  assert.equal(valid.code, "90837");
  assert.equal(valid.description, "Psychotherapy, 60 minutes");
  assert.throws(
    () => validateServiceCode({
      ...valid,
      code: " ",
      default_fee_cents: -1,
    }),
  );
  assert.throws(() => validateServiceCode({ ...valid, default_units: 0 }));
  assert.throws(() => validateServiceCode({ ...valid, default_duration_minutes: 0 }));
});

test("diagnosis and intervention validation require usable labels", () => {
  assert.equal(
    validateDiagnosisCode({ code: " F41.1 ", description: " Generalized anxiety disorder ", active: true, favorite: false, sort_order: 0 }).code,
    "F41.1",
  );
  assert.throws(() => validateDiagnosisCode({ code: " ", description: "Anxiety", active: true, favorite: false, sort_order: 0 }));
  assert.equal(
    validateIntervention({ name: " CBT ", category: " Cognitive ", active: true, sort_order: 0 }).name,
    "CBT",
  );
  assert.throws(() => validateIntervention({ name: " ", category: "", active: true, sort_order: 0 }));
});

test("location validation requires a name without over-normalizing address fields", () => {
  const location = validateLocation({
    name: " Main Office ",
    status: "active",
    address_line1: "123 W 1st Ave",
    address_line2: null,
    city: "Lakewood",
    state: "CO",
    postal_code: "80226-1234",
    phone: null,
    email: null,
    place_of_service_code: "11",
    is_billing_location: true,
    is_primary: true,
  });
  assert.equal(location.name, "Main Office");
  assert.equal(location.state, "CO");
  assert.equal(location.postal_code, "80226-1234");
  assert.throws(() => validateLocation({ ...location, name: " " }));
});
