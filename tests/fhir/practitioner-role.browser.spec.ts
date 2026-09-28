// Browser-runtime regression only. This does NOT claim live ingestion, database,
// authorization, or provider-screen coverage: those integrations do not exist yet.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source = stripTypeScriptTypes(readFileSync(new URL('../../supabase/functions/fhir-practitioner-role/normalizer.ts', import.meta.url), 'utf8'));
for (const reverse of [false, true]) test(`browser preserves independent contacts (reverse=${reverse})`, async ({ page }) => {
  const result = await page.evaluate(async ({ source, reverse }) => {
    const url = URL.createObjectURL(new Blob([source], {type:'text/javascript'}));
    try {
      const {normalizePractitionerRole, NPI_SYSTEM, NUCC_SYSTEM} = await import(url);
      const telecom = [{system:'email',use:'work',value:'provider@clinic.example'},{system:'phone',use:'work',value:'3035550100'}];
      if (reverse) telecom.reverse();
      return await normalizePractitionerRole({resourceType:'PractitionerRole',identifier:[{system:NPI_SYSTEM,value:'1234567893'}],specialty:[{coding:[{system:NUCC_SYSTEM,code:'1041C0700X'}]}],telecom, healthcareService:null,qualification:null}, {taxonomyVersion:'test-only',taxonomyExists:(code:string)=>code==='1041C0700X'});
    } finally { URL.revokeObjectURL(url); }
  }, {source,reverse});
  expect(result.telecom).toEqual({workEmails:['provider@clinic.example'],clinicPhones:['3035550100']});
  expect(result.specialties[0].code).toBe('1041C0700X');
  expect(result.healthcareService).toEqual([]);
  expect(result.qualification).toEqual([]);
});
test('browser gets controlled validation error for bad NPI', async ({page})=> {
  const code = await page.evaluate(async source => {
    const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
    try {
      const m=await import(url);
      try { await m.normalizePractitionerRole({resourceType:'PractitionerRole',identifier:[{system:m.NPI_SYSTEM,value:'1234567894'}]}, {taxonomyVersion:'test-only',taxonomyExists:()=>true}); }
      catch(error) { return (error as {code:string}).code; }
    } finally { URL.revokeObjectURL(url); }
  },source);
  expect(code).toBe('INVALID_NPI');
});
