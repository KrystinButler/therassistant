import test from "node:test";
import assert from "node:assert/strict";

import {
  build837PText,
  buildCms1500Html,
  validate837PExport,
} from "../src/domains/billing/claim-output";

const sample = {
  batch: { id: "batch-123", batch_name: "Aetna 2026-09-20" },
  edi: {
    submitterName: "Therassistant Billing",
    submitterId: "SUBMIT123",
    receiverName: "Example Clearinghouse",
    receiverId: "RECEIVER01",
    contactName: "Billing Team",
    contactPhone: "3035551212",
    contactEmail: "billing@example.com",
    billingProviderName: "Example Behavioral Health LLC",
    billingProviderNpi: "1234567893",
    billingProviderTaxId: "123456789",
    billingProviderTaxonomy: "101YP2500X",
    addressLine1: "100 Main St",
    addressLine2: "",
    city: "Denver",
    state: "CO",
    postalCode: "80202",
    usageIndicator: "T" as const,
    payerIds: { "payer-1": "60054" },
  },
  claims: [{
    claim: {
      id: "claim-1",
      patient_control_number: "TH-1001",
      total_charge_cents: 15000,
      service_date_from: "2026-09-01",
      payer_id: "payer-1",
      payerName: "Aetna",
      clientName: "Demo Patient",
      providerName: "Demo Provider",
    },
    client: {
      id: "client-1",
      first_name: "Demo",
      last_name: "Patient",
      date_of_birth: "1990-01-02",
      address_line1: "200 Patient Rd",
      city: "Denver",
      state: "CO",
      postal_code: "80203",
      metadata: { sex: "F" },
    },
    provider: {
      id: "provider-1",
      first_name: "Demo",
      last_name: "Provider",
      individual_npi: "1093987654",
      taxonomy_code: "101YP2500X",
    },
    payer: {
      id: "payer-1",
      name: "Aetna",
      clearinghouse_payer_id: "60054",
    },
    policy: {
      id: "policy-1",
      member_id: "W123456789",
      relationship_to_subscriber: "self",
    },
    lines: [{
      cpt_code: "90837",
      charge_amount_cents: 15000,
      units: 1,
      diagnosis_pointer: "1",
      service_date: "2026-09-01",
      place_of_service: "10",
    }],
    diagnoses: [{ diagnosis_code: "F41.1", pointer_order: 1 }],
  }],
};

test("837P export uses configured trading-partner and claim data without demo placeholders", () => {
  assert.deepEqual(validate837PExport(sample), []);
  const x12 = build837PText(sample, new Date("2026-09-20T15:30:00.000Z"));
  assert.match(x12, /ST\*837\*0001\*005010X222A1~/);
  assert.match(x12, /NM1\*41\*2\*Therassistant Billing/);
  assert.match(x12, /NM1\*PR\*2\*Aetna\*{5}PI\*60054~/);
  assert.match(x12, /CLM\*TH-1001\*150\.00\*{3}10:B:1/);
  assert.match(x12, /SV1\*HC:90837\*150\.00\*UN\*1/);
  assert.match(x12, /DTP\*472\*D8\*20260901~/);
  assert.doesNotMatch(x12, /DEMO_PAYER|\*DEMO~/);
  assert.match(x12, /IEA\*1\*/);
});

test("837P export refuses missing production data instead of inserting placeholders", () => {
  const invalid = {
    ...sample,
    edi: { ...sample.edi, submitterId: "" },
  };
  const errors = validate837PExport(invalid);
  assert.ok(errors.some((error) => error.includes("Submitter ID")));
  assert.throws(() => build837PText(invalid), /837P export is not ready/);
});

test("837P export emits a dependent patient loop when subscriber differs from patient", () => {
  const dependent = {
    ...sample,
    claims: [{
      ...sample.claims[0],
      policy: {
        ...sample.claims[0].policy,
        group_number: "GRP100",
        relationship_to_subscriber: "spouse",
        subscriber_dob: "1988-05-04",
        metadata: {
          subscriber: {
            first_name: "Alex",
            last_name: "Subscriber",
            dob: "1988-05-04",
            sex: "M",
            address_line1: "300 Subscriber Ave",
            city: "Denver",
            state: "CO",
            postal_code: "80204",
          },
        },
      },
    }],
  };

  assert.deepEqual(validate837PExport(dependent), []);
  const x12 = build837PText(dependent, new Date("2026-09-20T15:30:00.000Z"));
  assert.match(x12, /HL\*2\*1\*22\*1~/);
  assert.match(x12, /SBR\*P\*01\*GRP100/);
  assert.match(x12, /NM1\*IL\*1\*Subscriber\*Alex\*{4}MI\*W123456789~/);
  assert.match(x12, /HL\*3\*2\*23\*0~/);
  assert.match(x12, /PAT\*01~/);
  assert.match(x12, /NM1\*QC\*1\*Patient\*Demo~/);
});

test("837P export blocks dependent claims when subscriber demographics are incomplete", () => {
  const invalid = {
    ...sample,
    claims: [{
      ...sample.claims[0],
      policy: {
        ...sample.claims[0].policy,
        relationship_to_subscriber: "child",
        metadata: { subscriber: { first_name: "Alex" } },
      },
    }],
  };
  const errors = validate837PExport(invalid);
  assert.ok(errors.some((error) => error.includes("subscriber last name")));
  assert.ok(errors.some((error) => error.includes("subscriber ZIP code")));
});

test("837P export does not guess an ambiguous legacy relationship", () => {
  const invalid = {
    ...sample,
    claims: [{
      ...sample.claims[0],
      policy: {
        ...sample.claims[0].policy,
        relationship_to_subscriber: "parent",
      },
    }],
  };
  assert.ok(validate837PExport(invalid).some((error) => error.includes("supported HIPAA relationship code")));
});

test("CMS-1500 print output includes patient, payer, POS and service line context", () => {
  const html = buildCms1500Html(sample.claims[0]);
  assert.match(html, /CMS-1500 Claim Data/);
  assert.match(html, /Demo Patient/);
  assert.match(html, /Aetna/);
  assert.match(html, /90837/);
  assert.match(html, />10</);
});
