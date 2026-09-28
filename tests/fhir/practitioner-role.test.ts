import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePractitionerRole, PractitionerRoleValidationError, NPI_SYSTEM, NUCC_SYSTEM } from '../../supabase/functions/fhir-practitioner-role/normalizer.ts';

// Synthetic fixtures: checksum validity does not establish provider identity.
export const fixture = () => ({
  resourceType: 'PractitionerRole', id: 'test-role',
  identifier: [{ system: NPI_SYSTEM, value: '1234567893' }],
  specialty: [{ coding: [{ system: NUCC_SYSTEM, code: '1041C0700X' }] }],
  telecom: [{ system: 'email', use: 'work', value: 'provider@clinic.example' }, { system: 'phone', use: 'work', value: '3035550100' }],
  healthcareService: [{ reference: 'HealthcareService/test' }],
});
const dependencies = { taxonomyVersion: 'test-only', taxonomyExists: (code: string) => ['1041C0700X', '101YP2500X'].includes(code) };
const normalize = (payload: unknown) => normalizePractitionerRole(payload, dependencies);
const rejects = (payload: unknown, code: string) => assert.rejects(() => normalize(payload), (error: unknown) => error instanceof PractitionerRoleValidationError && error.code === code);

test('accepts valid NPI and NUCC coding', async () => {
  const result = await normalize(fixture());
  assert.equal(result.npi, '1234567893');
  assert.deepEqual(result.specialties, [{ system: NUCC_SYSTEM, code: '1041C0700X' }]);
  assert.equal(result.taxonomyVersion, 'test-only');
});
for (const value of ['123456789', '12345678930', '12345A7893', '1234567894', ' 1234567893 ', '', 1234567893, null]) {
  test(`rejects invalid NPI ${JSON.stringify(value)}`, () => rejects({ ...fixture(), identifier: [{ system: NPI_SYSTEM, value }] }, 'INVALID_NPI'));
}
for (const identifier of [undefined, null, [], {}, [{ system: 'urn:role', value: '1234567893' }]]) {
  test(`rejects missing NPI ${JSON.stringify(identifier)}`, () => rejects({ ...fixture(), identifier }, 'INVALID_NPI'));
}
test('selects NPI by system, not position', async () => {
  const p = fixture(); p.identifier.unshift({ system: 'urn:role', value: 'role-1' });
  assert.equal((await normalize(p)).npi, '1234567893');
});
test('rejects conflicting NPI identifiers', () => rejects({ ...fixture(), identifier: [ ...fixture().identifier, { system: NPI_SYSTEM, value: '1245319599' }] }, 'INVALID_NPI'));
test('accepts duplicate identical NPI identifiers', async () => {
  assert.equal((await normalize({ ...fixture(), identifier: [...fixture().identifier, ...fixture().identifier] })).npi, '1234567893');
});
for (const coding of [[{ system: 'urn:other', code: '1041C0700X' }], [{ system: NUCC_SYSTEM, code: '999999999X' }], [{ system: NUCC_SYSTEM }], [null], []]) {
  test(`rejects invalid specialty ${JSON.stringify(coding)}`, () => rejects({ ...fixture(), specialty: [{ coding }] }, 'INVALID_TAXONOMY'));
}
test('preserves multiple specialties and selects NUCC among other systems', async () => {
  const specialty = [{ coding: [{ system: 'urn:other', code: 'x' }, { system: NUCC_SYSTEM, code: '1041C0700X' }] }, { coding: [{ system: NUCC_SYSTEM, code: '101YP2500X' }] }];
  assert.deepEqual((await normalize({ ...fixture(), specialty })).specialties.map(s => s.code), ['1041C0700X', '101YP2500X']);
});
test('awaits asynchronous taxonomy lookup and rejects retired codes', async () => {
  await assert.rejects(() => normalizePractitionerRole(fixture(), { taxonomyVersion: 'test', taxonomyExists: async () => false }), { code: 'INVALID_TAXONOMY' });
});
test('does not disguise reference service outage as invalid input', async () => {
  await assert.rejects(() => normalizePractitionerRole(fixture(), { taxonomyVersion: 'test', taxonomyExists: async () => { throw new Error('unavailable'); } }), /unavailable/);
});
test('requires versioned taxonomy dependency', async () => {
  await assert.rejects(() => normalizePractitionerRole(fixture(), { ...dependencies, taxonomyVersion: '' }), /version/i);
});
for (const reverse of [false, true]) {
  test(`preserves separate contacts with reverse=${reverse}`, async () => {
    const p = fixture(); p.telecom.push({system:'phone',use:'work',value:'3035550101'}, {system:'email',use:'work',value:'second@clinic.example'}, {system:'fax',use:'work',value:'3035550199'}, {system:'email',use:'home',value:'home@example.com'});
    if (reverse) p.telecom.reverse();
    const result = await normalize(p);
    assert.deepEqual(result.telecom.workEmails.sort(), ['provider@clinic.example', 'second@clinic.example']);
    assert.deepEqual(result.telecom.clinicPhones.sort(), ['3035550100', '3035550101']);
  });
}
for (const field of ['specialty', 'telecom', 'healthcareService', 'qualification']) for (const value of [null, undefined, []]) {
  test(`${field} ${JSON.stringify(value)} uses defaults`, async () => {
    const result = await normalize({ ...fixture(), [field]: value });
    if (field === 'telecom') assert.deepEqual(result.telecom, {workEmails:[],clinicPhones:[]});
    else assert.deepEqual(result[field === 'specialty' ? 'specialties' : field as 'healthcareService'|'qualification'], []);
  });
}
test('all optional arrays can be null together', async () => {
  const r = await normalize({ ...fixture(), specialty:null, telecom:null, healthcareService:null, qualification:null });
  assert.deepEqual([r.specialties,r.telecom.workEmails,r.telecom.clinicPhones,r.healthcareService,r.qualification], [[],[],[],[],[]]);
});
test('skips null contacts and service members without losing valid members', async () => {
  const r = await normalize({ ...fixture(), telecom:[null, ...fixture().telecom], healthcareService:[null,{reference:'HealthcareService/a'},{reference:'HealthcareService/b'}] });
  assert.deepEqual(r.healthcareService, ['HealthcareService/a','HealthcareService/b']);
  assert.deepEqual(r.telecom.workEmails,['provider@clinic.example']);
});
for (const field of ['specialty','telecom','healthcareService']) test(`rejects ${field} with non-array structure`, () => rejects({...fixture(),[field]:{}},'INVALID_STRUCTURE'));
for (const payload of [null, [], 'bad', {}, {...fixture(),resourceType:'Practitioner'}]) test(`rejects wrong resource ${JSON.stringify(payload)}`,()=>rejects(payload,'INVALID_RESOURCE'));
test('qualification is not imported into PractitionerRole', async () => {
  assert.deepEqual((await normalize({...fixture(),qualification:[{code:{text:'not a role field'}}]})).qualification,[]);
});
test('never mutates the incoming payload', async () => {
  const p = fixture(); const before = structuredClone(p); await normalize(p); assert.deepEqual(p,before);
});
