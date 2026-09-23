import assert from "node:assert/strict";
import test from "node:test";
import {buildReviewDraft,outcomeTrend,validateScore} from "../src/domains/treatment-plans/outcome-review-model";
test("instrument score ranges are enforced",()=>{
  assert.equal(validateScore("PHQ-9",27),true);
  assert.equal(validateScore("PHQ-9",28),false);
  assert.equal(validateScore("GAD-7",21),true);
  assert.equal(validateScore("GAD-7",-1),false);
});
test("trends use dated scores and do not infer causation",()=>{
  const result=outcomeTrend([
    {id:"later",instrument:"GAD-7",score:8,assessed_on:"2026-09-01"},
    {id:"earlier",instrument:"GAD-7",score:13,assessed_on:"2026-06-01"}
  ],"GAD-7");
  assert.equal(result?.delta,-5);
});
test("review draft includes goals, score changes and visit count, but no prior narrative",()=>{
  const out=buildReviewDraft({
    plan:{id:"plan",effective_date:"2026-06-01",problem_statement:"Anxiety",goals:[{goal_text:"Improve coping",objective_text:"Practice grounding",status:"active"}]},
    measures:[{id:"a",instrument:"GAD-7",score:14,assessed_on:"2026-06-01"},{id:"b",instrument:"GAD-7",score:8,assessed_on:"2026-09-01"}],
    visits:[{service_date:"2026-07-01",note_status:"signed"}],
    reviewDate:"2026-09-22"
  });
  assert.match(out.draftText,/Improve coping/);
  assert.match(out.draftText,/change -6/);
  assert.match(out.draftText,/1 signed visit/);
  assert.match(out.draftText,/CLINICIAN TO COMPLETE/);
  assert.equal(out.draftText.includes("previous note text"),false);
});
