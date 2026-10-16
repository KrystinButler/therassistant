import test from 'node:test';
import assert from 'node:assert/strict';
import { phqImportNarrative } from '../src/domains/clinical/clinical-note-imports.ts';
import { formDate, unsignedRows, saveThenSign } from '../src/domains/clinical/workspace-actions.ts';

test('screening narrative identifies its instrument without internal import numbers', () => {
  assert.match(phqImportNarrative([{instrument:'PHQ-9', score:8, assessed_on:'2026-10-15'}]), /^PHQ-9:/);
});
test('date stays October 15 in Denver after UTC midnight and service date wins', () => {
  const now = new Date('2026-10-16T04:30:00Z');
  assert.equal(formDate(undefined,'America/Denver',now),'2026-10-15');
  assert.equal(formDate('2026-10-12','America/Denver',now),'2026-10-12');
});
test('unsigned work includes unstarted encounters and drafts but excludes signed', () => {
  assert.deepEqual(unsignedRows([{signed:false},{signed:true},{signed:false}]),[{signed:false},{signed:false}]);
});
test('save and sign uses the returned saved record and never signs after save failure', async () => {
  const order:string[]=[];
  await saveThenSign(async()=>{order.push('save');return {id:'new',note_text:'current'};}, async note=>{order.push(note.id+':'+note.note_text);return true;});
  assert.deepEqual(order,['save','new:current']);
  await assert.rejects(saveThenSign(async()=>{throw Error('offline');},async()=>{assert.fail('must not sign');}));
});

test('safety narrative labels each patient response and preserves review warning', async () => {
  const { cssrsImportNarrative } = await import('../src/domains/clinical/clinical-note-imports.ts');
  const text = cssrsImportNarrative([{instrument:'C-SSRS',source:'patient_reported',narrative:'Answers: [true, false, null, false, false, true, false]. No clinician risk classification is documented.'}]);
  assert.match(text,/Item 1: Yes/);
  assert.match(text,/Item 3: Not answered/);
  assert.doesNotMatch(text,/\[true/);
  assert.match(text,/Clinician safety review is required/);
});
