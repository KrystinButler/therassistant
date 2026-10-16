import test from 'node:test';
import assert from 'node:assert/strict';
import * as actions from '../src/domains/clinical/workspace-actions.ts';

test('clinical queue resumes the most recently updated nonvoided encounter for a visit', () => {
  assert.equal(typeof actions.encountersByAppointment, 'function');
  const latest = {id:'draft', appointment_id:'visit', encounter_status:'in_progress'};
  const older = {id:'old', appointment_id:'visit', encounter_status:'completed'};
  const voided = {id:'voided', appointment_id:'visit', encounter_status:'voided'};
  const direct = {id:'direct', appointment_id:null, encounter_status:'in_progress'};
  const index = actions.encountersByAppointment([voided, latest, older, direct]);
  assert.equal(index.get('visit')?.id, 'draft');
  assert.equal(index.size, 1);
});
