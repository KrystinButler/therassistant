# Production design audit — 2026-09-25

Baseline: `4de5969`, Vercel production `dpl_4Z6TaT92962eoRrdLQoQ5voofJYb`, https://therassistant.vercel.app.

Inspected live as authorized staff: dashboard, schedule (empty and populated day), appointment editor, patient review drawer, patient chart overview/care, signed encounter, Claims, empty Rejections & Validation Holds, and synthetic staff portal preview. No clinical records were edited. Product Design was unavailable in this session; the Portal Structure and Usability Audit method was used.

References: approved dashboard concept and ten September 15 reference screens supplied September 25. Preserve compact Inter (later user direction overrides serif headings in the dashboard image), navy/sage/cream, distinct white cards, equal encounter panels and the 75%-width patient review drawer. Reference-only features, authorization gates and patient balance restrictions are excluded.

| Priority | Surface / evidence | Observed problem | Correction / disposition |
| --- | --- | --- | --- |
| High | Live appointment editor, chart actions, encounter imports; shared `.thera-action` | Action controls render as minimally padded text, with no shared border, radius or minimum target size. | Define shared button geometry, distinct primary/secondary/disabled states and visible focus, including portalled drawers. Preserve handlers. |
| High | Drawer source and live appointment editor | Sticky header can cover the close control because the header has a higher stacking level. | Raise and enlarge the close target. Preserve discard confirmation. |
| High | Patient journal/check-in CSS, source only | Navigation is hidden at mobile widths; meaningful text reaches 7–9px. | Retain existing navigation as wrapping links and raise meaningful labels/details to 12px. Keep mobile inputs at 16px and touch actions at least 40–44px. |
| Medium | Live encounter | LV/TP/JR/DC are the only visible context labels; inaccessible names repeat abbreviations. | Show full labels, supply explicit accessible names and pressed states; keep all existing panels. |
| Medium | Encounter CSS, source only | At 761–1100px an open context panel overlays 360px of the note editor. | Preserve two equal columns until the existing stacked mobile layout. |
| Medium | Live schedule | Provider filter has no accessible label; selected view is visual only. | Add filter label and pressed states. |
| Medium | Live chart | Section selection has no programmatic selected state; “Care-to-Claim Spine” is implementation jargon. | Add labeled button group/pressed states; rename summary to “Visits, Notes & Claims.” No data changes. |
| Medium | Live Claims / Rejections | Claims has no direct link to the correction queue, including when empty. | Add reciprocal links to the existing queues. Preserve routing and correction-field links. |
| Medium | Shell source | Translated offscreen mobile navigation remains keyboard-focusable. No skip link. | Hide closed navigation from focus and add a skip-to-main link. |
| Low | Live dashboard/chart/encounter | Primary forest hue differs from navy reference; headings have inconsistent weight; alert treatment is missing. | Restore primary navy with sage accents; standardize heading weight and alert surfaces. |

## Preserved behavior

Patient/provider identity boundaries, journal permissions, note signing/locking, encounter templates, service coding, clinical access, claim correction targets, save/discard behavior and database schema are unchanged. Patient review remains 75vw on desktop and full width on mobile. No authorizations or CRM/payment-desk work added.

## Validation and limits

- Release phase-3 TypeScript check passed.
- Existing unit suite: 487 passed, 0 failed.
- Vite production build passed (existing bundle-size and sheet sourcemap warnings).
- Desktop production inspected using the live staff session; post-deployment verification recorded below.
- Responsive fixes are source-reviewed; this browser interface did not expose viewport emulation. No real-device/mobile test claimed.
- Patient-only journal/check-in screens are source-reviewed. Staff preview is synthetic, not evidence of actual patient authorization or successful submission.
- Rejections queue is empty for this staff tenant; populated correction interactions were not exercised against production. Existing correction tests passed.
- Signed encounter inspected read-only; no sign/save/claim-submission mutation testing performed.
