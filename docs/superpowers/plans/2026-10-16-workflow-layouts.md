# Workflow layout implementation

Goal: apply the approved documentation, queue/detail and configuration patterns without changing clinical or financial write ownership.

1. Add shared accessible inline review support to WorkDrawer and shared queue-state parsing. Desktop keeps queue and selected record together; compact widths retain the existing modal interaction.
2. Patient chart: persistent identity/summary, actionable note link, flat Care destinations, preserved tab URL and mounted editors during local navigation.
3. Claim 360: summary and service lines beside responses, denials and work/history; keep source and operational links.
4. Claims, payment and denial queues: dock read-only detail alongside worklist, retain existing posting/edit confirmation drawers, preserve URL filters and record navigation.
5. Claims work: replace follow-up tabs with expandable sections while keeping correction fields and unsaved-change protection.
6. Navigation: concise grouped clinical/RCM/practice menu, persistent page headers and consistent responsive layouts for existing administration pages.
7. Scheduling: expose direct existing-note and safe video actions on rows; preserve appointment review.
8. Verify date/screening/signature regressions, typecheck and production build; publish review branch with exact scope and limitations.

No inferred findings, automatic clinical assertions, payer submissions or payment posting occur during layout validation. PHQ-9/GAD-7 stay intact and suicide assessments remain clinician-led.
