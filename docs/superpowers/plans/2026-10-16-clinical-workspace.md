# Clinical workspace implementation plan

Goal: implement the approved three-module encounter specification in the existing EHR.
Execution: native, preserving existing note storage and separate private psychotherapy records.

- [ ] Consolidate writing into the existing authoritative noteText canvas. Keep source context and private notes accessible; add saved preview.
- [ ] Replace telehealth/editor/context three-column competition with a wide canvas and optional context; wrap insertion tools and preserve keyboard focus.
- [ ] Derive selected session goal everywhere from goalAddressed; consolidate screening scores and readable source summaries.
- [ ] Add Care local navigation and actionable unsigned default queue; qualify encounter, note and billing statuses.
- [ ] Save current draft before signature, bind signing to returned note identity and content, preserve partial failure feedback.
- [ ] Replace UTC date defaults with service date or explicit local timezone date; verify midnight boundary.
- [ ] Run regression tests, typecheck, build, inspect changes, publish and verify deployment.

Verification: test screening narrative labels, missing prior results, save/sign ordering and failure, revision conflict, queue filtering and timezone boundary. Run existing release build command. Authenticated clinical signing must not be exercised on real records during UI verification.
