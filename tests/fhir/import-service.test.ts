import test from "node:test";
import assert from "node:assert/strict";
import { importRole } from "../../supabase/functions/fhir-practitioner-role/service.ts";
const payload = {
  resourceType: "PractitionerRole",
  id: "synthetic-role",
  identifier: [
    { system: "http://hl7.org/fhir/sid/us-npi", value: "1234567893" },
  ],
  specialty: [
    {
      coding: [
        { system: "http://nucc.org/provider-taxonomy", code: "1041C0700X" },
      ],
    },
  ],
  telecom: [
    { system: "email", use: "work", value: "provider@example.com" },
    { system: "phone", use: "work", value: "3035550100" },
  ],
};
const body = {
  tenant_id: "11111111-1111-4111-8111-111111111111",
  source: "test-directory",
  resource: payload,
};
const base = {
  authorize: async () => true,
  findProviders: async () => [{ id: "provider-1" }],
  save: async (value: unknown) => value,
};
test("denies unauthorized tenant before lookup or write", async () => {
  await assert.rejects(
    () =>
      importRole(body, {
        ...base,
        authorize: async () => false,
        findProviders: async () => {
          throw Error("must not run");
        },
      }),
    { status: 403 },
  );
});
test("rejects NPI without tenant provider match", async () => {
  await assert.rejects(
    () => importRole(body, { ...base, findProviders: async () => [] }),
    { status: 422 },
  );
});
test("rejects ambiguous provider match", async () => {
  await assert.rejects(
    () =>
      importRole(body, {
        ...base,
        findProviders: async () => [{ id: "a" }, { id: "b" }],
      }),
    { status: 422 },
  );
});
test("preview validates but does not persist", async () => {
  const r = await importRole(
    { ...body, preview: true },
    {
      ...base,
      save: async () => {
        throw Error("must not write");
      },
    },
  );
  assert.equal(r.preview, true);
  assert.equal(r.normalized.npi, "1234567893");
});
test("saves both contact types and a stable source key", async () => {
  let saved: any;
  await importRole(body, {
    ...base,
    save: async (row) => {
      saved = row;
      return row;
    },
  });
  assert.equal(saved.external_id, "synthetic-role");
  assert.equal(saved.tenant_id, body.tenant_id);
  assert.equal(saved.provider_id, "provider-1");
  assert.deepEqual(saved.normalized.telecom, {
    workEmails: ["provider@example.com"],
    clinicPhones: ["3035550100"],
  });
});
test("invalid NPI cannot be persisted", async () => {
  await assert.rejects(
    () =>
      importRole(
        { ...body, resource: { ...payload, identifier: [] } },
        {
          ...base,
          save: async () => {
            throw Error("must not write");
          },
        },
      ),
    { code: "INVALID_NPI" },
  );
});
test("missing external id is rejected", async () => {
  await assert.rejects(
    () =>
      importRole({ ...body, resource: { ...payload, id: undefined } }, base),
    { status: 422 },
  );
});
