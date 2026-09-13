import test from "node:test";
import assert from "node:assert/strict";

import {
  authorizationAlert,
  buildAuthorizationValues,
  buildAuthorizationUnitValues,
  planAuthorizationUse,
} from "../src/domains/authorizations/workflow.ts";

test("authorization values require patient-facing essentials", () => {
  assert.throws(
    () => buildAuthorizationValues({ payerId: "", status: "approved" }),
    /payer/i,
  );
  const values = buildAuthorizationValues({
    payerId: "payer-1",
    authorizationNumber: "AUTH-123",
    status: "approved",
    startDate: "2026-09-01",
    endDate: "2026-12-31",
  });
  assert.equal(values.authorization_number, "AUTH-123");
  assert.equal(values.status, "approved");
});

test("authorization unit values never write generated remaining_units", () => {
  const values = buildAuthorizationUnitValues({ cptCode: "90837", authorizedUnits: 12, usedUnits: 3 });
  assert.equal(values.authorized_units, 12);
  assert.equal(values.used_units, 3);
  assert.equal("remaining_units" in values, false);
});

test("authorization use cannot exceed remaining units", () => {
  assert.throws(
    () => planAuthorizationUse({ authorizedUnits: 10, usedUnits: 9, requestedUnits: 2 }),
    /remaining units/i,
  );
  assert.equal(
    planAuthorizationUse({ authorizedUnits: 10, usedUnits: 7, requestedUnits: 2 }),
    9,
  );
});

test("authorization alerts distinguish low, exhausted and expired", () => {
  assert.equal(
    authorizationAlert({ status: "approved", endDate: "2026-12-31", remainingUnits: 2 }, new Date("2026-09-13")).code,
    "low_units",
  );
  assert.equal(
    authorizationAlert({ status: "approved", endDate: "2026-12-31", remainingUnits: 0 }, new Date("2026-09-13")).code,
    "exhausted",
  );
  assert.equal(
    authorizationAlert({ status: "approved", endDate: "2026-09-01", remainingUnits: 5 }, new Date("2026-09-13")).code,
    "expired",
  );
});
