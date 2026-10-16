import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPatientReviewCheckIn } from '../src/domains/scheduling/patient-review-model';
import { buildPreVisitNoteInsert } from '../src/domains/encounters/clinical-source-context';
import { phqImportNarrative, screeningContext } from '../src/domains/clinical/clinical-note-imports';
const checkin = { id:'intake', responses:{ pre_visit:{ submitted_at:'2026-10-16T01:00:00Z', visit_questions:{focus_today:'Sleep', screeners:{phq9:[1,1,1,1,1,1,1,1,0],gad7:[0,0,0,0,0,0,0]}, treatment_plan_review:{status:'reviewed',plan_id:'plan'},goal_updates:[{goal_id:'goal',goal_text:'Improve sleep',progress:'Slept better',barriers:'Shift work'}]}}}};
test('SOAP intake contains exact scores including zero and patient goal updates',()=>{
 const text=buildPreVisitNoteInsert(buildPatientReviewCheckIn(checkin));
 assert.match(text,/PHQ-9: 8 \/ 27/); assert.match(text,/GAD-7: 0 \/ 21/);
 assert.match(text,/Slept better/); assert.match(text,/Shift work/); assert.match(text,/Treatment plan review: reviewed/);
});
test('incomplete score is not transformed into a zero or a clinical interpretation',()=>{
 assert.equal(phqImportNarrative([{instrument:'PHQ-9',score:null}]),'');
});
test('an appointment-linked screener from another visit cannot become current context',()=>{
 const rows=screeningContext([{instrument:'PHQ-9',score:18,source_reference_id:'other',assessed_on:'2026-10-16',created_at:'2026-10-16T00:00:00Z'}],'this','2026-10-16','2026-10-16T01:00:00Z');
 assert.equal(rows.length,0);
});

test('draft answers never appear in the imported block',()=>{
 const draft=structuredClone(checkin);draft.responses.pre_visit.submitted_at='';
 assert.equal(buildPreVisitNoteInsert(buildPatientReviewCheckIn(draft)),'');
});
test('a deferred screener never imports previously entered scores',()=>{
 const deferred=structuredClone(checkin) as any;deferred.responses.pre_visit.visit_questions.screeners.declined=true;
 const text=buildPreVisitNoteInsert(buildPatientReviewCheckIn(deferred));
 assert.match(text,/deferred/);assert.doesNotMatch(text,/PHQ-9: 8/);
});

import { hydratePortalSoapNote } from '../src/domains/encounters/clinical-source-context';
import { readNoteSection } from '../src/domains/clinical/note-section-editing';
test('automatic import fills SOAP section controls and preserves provider assessment and plan',()=>{
 const before='Subjective:\nProvider history\n\nObjective:\nProvider observations\n\nAssessment:\nProvider assessment\n\nPlan:\nProvider plan';
 const after=hydratePortalSoapNote(before,buildPatientReviewCheckIn(checkin));
 assert.match(readNoteSection(after,'Subjective'),/Sleep/);
 assert.match(readNoteSection(after,'Objective'),/PHQ-9: 8/);
 assert.match(readNoteSection(after,'Subjective'),/Provider history/);
 assert.equal(readNoteSection(after,'Assessment'),'Provider assessment');
 assert.equal(readNoteSection(after,'Plan'),'Provider plan');
 assert.equal(hydratePortalSoapNote(after,buildPatientReviewCheckIn(checkin)),after);
});
