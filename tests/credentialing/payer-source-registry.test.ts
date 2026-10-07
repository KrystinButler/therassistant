import assert from "node:assert/strict";
import test from "node:test";

import {
  getPayerSource,
  TARGET_PAYER_SOURCE_KEYS,
} from "../../artifacts/api-server/src/modules/credentialing/payer-sources.ts";

test("every SPEC-1 payer and Colorado RAE has an explicit source strategy", () => {
  const expected = [
    "cms_medicare",
    "health_first_colorado",
    "rae_rmhp",
    "rae_northeast_health_partners",
    "rae_ccha",
    "rae_colorado_access",
    "aetna",
    "anthem",
    "cigna",
    "uhc",
    "tricare_west",
  ];

  for (const key of expected) {
    assert.ok(TARGET_PAYER_SOURCE_KEYS.includes(key), `${key} must be registered`);
    const source = getPayerSource(key);
    assert.ok(source, `${key} must resolve`);
    assert.match(source.officialUrl, /^https:\/\//);
    assert.ok(source.mode === "automated" || source.mode === "controlled_fallback");
  }
});

test("Cigna records its public FHIR provider directory as an automation-capable source", () => {
  const source = getPayerSource("cigna");
  assert.equal(source?.mode, "automated");
  assert.equal(source?.sourceType, "FHIR_PROVIDER_DIRECTORY");
  assert.match(source?.baseUrl ?? "", /^https:\/\/fhir\.cigna\.com\/ProviderDirectory\/v1\/?$/);
});

test("sources that cannot safely prove selected plan/network participation remain controlled fallbacks", () => {
  for (const key of ["aetna", "anthem", "uhc", "tricare_west"]) {
    const source = getPayerSource(key);
    assert.ok(source);
    if (source?.mode === "controlled_fallback") {
      assert.match(source.reason ?? "", /plan|network|directory|credential|registration|machine-readable/i);
    }
  }
});

test("NPPES and Medicare FFS enrollment are supporting evidence, not substitutes for selected payer network evidence", () => {
  const medicare = getPayerSource("cms_medicare");
  assert.ok(medicare?.supportingSources.includes("nppes"));
  assert.ok(medicare?.supportingSources.includes("cms_pecos_ffs"));
  assert.notEqual(medicare?.sourceType, "NPPES_IDENTITY");
  assert.notEqual(medicare?.sourceType, "CMS_PECOS_MEDICARE_FFS");
});
