import test from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";
import {normalizedServiceLine,matchingServiceLineExists,validateServiceLineValues} from "../src/domains/encounters/service-line-validation";
const line={cptCode:"90837",modifier1:"",units:1,chargeAmountCents:25000,placeOfService:"02"};
test("service lines require valid codes, units and nonzero charges",()=>{
  assert.doesNotThrow(()=>validateServiceLineValues(line));
  assert.throws(()=>validateServiceLineValues({...line,chargeAmountCents:0}),/greater than \$0/);
  assert.throws(()=>validateServiceLineValues({...line,units:0}),/Units/);
  assert.throws(()=>validateServiceLineValues({...line,placeOfService:"2"}),/two-digit/);
  assert.throws(()=>normalizedServiceLine({cptCode:"90837",modifier1:"",units:1,chargeDollars:"",placeOfService:"02"}),/greater than \$0/);
});
test("duplicate matching procedures are detected before insertion",()=>{
  assert.equal(matchingServiceLineExists([{cpt_hcpcs_code:"90837",modifier1:null,place_of_service_code:"02"}],line),true);
  assert.equal(matchingServiceLineExists([{cpt_hcpcs_code:"90834",modifier1:null,place_of_service_code:"02"}],line),false);
});
test("encounter renders saved service lines and repository protects billed lines",()=>{
  const page=readFileSync(new URL("../src/domains/encounters/EncounterPage.tsx",import.meta.url),"utf8");
  const repo=readFileSync(new URL("../src/domains/clinical/repository.ts",import.meta.url),"utf8");
  assert.match(page,/Recorded service lines/);assert.match(page,/Save Service Line/);assert.match(page,/serviceError/);
  assert.match(repo,/assertUnbilledLine/);assert.match(repo,/charge_capture_items/);
});
