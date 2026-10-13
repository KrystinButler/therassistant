import test from 'node:test';
import assert from 'node:assert/strict';
import { appointmentCheckIn, buildPatientReviewCheckIn } from '../src/domains/scheduling/patient-review-model';
import { resolveClinicalServiceDate } from '../src/domains/clinical/service-date';
test('another appointment never supplies current visit answers', () => {
 const rows=[{appointment_id:'other',responses:{pre_visit:{submitted_at:'2026-10-12',visit_questions:{focus_today:'Other visit'}}}}];
 assert.equal(appointmentCheckIn(rows,'current'),null);
 assert.equal(appointmentCheckIn(rows,'other'),rows[0]);
});
test('free text safety answers remain unclassified for clinician review',()=>{
 for(const safety_concerns of ['No safety concerns reported today.','I feel unsafe.']){
 const result=buildPatientReviewCheckIn({responses:{pre_visit:{submitted_at:'2026-10-12',visit_questions:{safety_concerns}}}});
 assert.equal(result.safetyConcern,null); assert.equal(result.safetyText,safety_concerns);
 }
});
test('service date preserves saved date and uses appointment date for delayed documentation',()=>{
 assert.equal(resolveClinicalServiceDate({service_date:'2026-10-12'}, {started_at:'2026-10-13T02:00:00Z'},null,'America/Denver'),'2026-10-12');
 assert.equal(resolveClinicalServiceDate(null,{started_at:'2026-10-14T02:00:00Z'},{starts_at:'2026-10-13T02:00:00Z'},'America/Denver'),'2026-10-12');
 assert.equal(resolveClinicalServiceDate(null,{started_at:'2026-10-13T02:00:00Z'},null,'America/Denver'),'2026-10-12');
});
