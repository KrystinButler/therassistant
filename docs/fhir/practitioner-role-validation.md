# PractitionerRole directory validation

Implemented: a dependency-free TypeScript normalization boundary plus 59 node:test cases and three Playwright browser-runtime regression cases. The live integration adds an authenticated Supabase Edge Function and an Administration → Imports & Migration upload panel.

## Run

Use Node 24 (native TypeScript stripping):

- `pnpm run test:fhir`
- `pnpm exec playwright install chromium` then `pnpm run test:fhir:browser`

The browser tests run the actual normalizer in Chromium with synthetic inputs. They do not use invented EHR routes or claim database/UI end-to-end coverage. Their standalone configuration leaves the existing authenticated EHR suite unchanged.

## Contract

`supabase/functions/fhir-practitioner-role/normalizer.ts` exports `normalizePractitionerRole(payload, dependencies)` and structured `PractitionerRoleValidationError` errors with `code` and `field`.

Pass a trusted, versioned NUCC membership function through `taxonomyExists` and record its release in `taxonomyVersion`. The caller must check the code's effective status in that release. Lookup outages propagate to the caller rather than being misreported as invalid provider input. The small test code list is synthetic test infrastructure only; it is not the production taxonomy catalog.

This adapter implements the requested directory contract requiring a checksum-valid NPI in `PractitionerRole.identifier`, selected by the exact NPI system URI. Conflicting identifiers are rejected. This is stricter than base FHIR: role identifiers identify roles, and a directory may supply the practitioner's NPI in a linked Practitioner instead. Such feeds need an explicit reference-resolution adapter before this boundary; do not fetch arbitrary external references from the payload.

NUCC coding is selected from each specialty concept; multiple specialties are retained. Work emails and work phones stay separate and preserve multiple entries. Missing/null optional collections become empty arrays, null contact/service members are skipped, and non-array structures generate controlled errors. Qualification is ignored with an empty compatibility default because it belongs to Practitioner. The returned object is an internal DTO, deliberately labeled `sourceResourceType`; it is not a FHIR resource to export.

NPI checksum validation does not verify issuance, ownership, enrollment, or credentialing. Null-tolerant normalization is a directory adapter policy, not a claim that null collections are valid FHIR JSON.

## Live integration

`supabase/functions/fhir-practitioner-role` hosts the canonical normalizer, the import service, and the authenticated HTTP entrypoint. The Edge Function validates user sessions, checks practice write access, validates the payload, requires exactly one matching existing provider NPI within that tenant, and calls a service-only atomic save RPC. The RPC rechecks actor membership and provider/tenant/NPI alignment. Database writes cannot be called directly by browser users; RLS restricts reads to practice staff.

The import panel accepts one PractitionerRole JSON resource (maximum 250 KB), shows a validation preview, and saves only after the user clicks Save provider role. Source name plus external role ID provides idempotent update behavior within each practice. Role-specific contacts and specialties remain separate from provider-profile fields. The original role resource, importing user, and timestamps are retained. Recent imports display up to 50 records.

The bundled membership set contains 883 codes from the official NUCC 25.1 CSV, which NUCC also lists for January 2026. Its URL and SHA-256 are recorded in taxonomy.ts. It is a pinned reference release, not an automatically refreshed feed. Before changing releases, verify effective dates and regenerate the set from the official CSV. External directory polling and automatic CAQH connectivity are not included; this workflow imports files supplied by staff.

## Verification

- 59 Node validation/service tests pass.
- 508 existing EHR regression tests pass.
- Phase 3 TypeScript checking and frontend production build pass.
- Live transactional SQL checks pass for staff authorization, cross-tenant denial, patient denial, contact persistence, and duplicate prevention. All synthetic data was rolled back.
- Live Edge Function rejects unauthenticated HTTP requests with 401.
- The three standalone Chromium tests remain unexecuted because the browser download failed. A signed-in browser import is not claimed as verified.

References:
- https://hl7.org/fhir/R4/practitionerrole.html
- https://www.nucc.org/index.php/code-sets-mainmenu-41/provider-taxonomy-mainmenu-40/csv-mainmenu-57
