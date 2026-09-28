# PractitionerRole directory validation

Implemented: a dependency-free TypeScript normalization boundary plus 52 node:test cases and three Playwright browser-runtime regression cases. This is **not yet a live directory ingestion feature**.

## Run

Use Node 24 (native TypeScript stripping):

- `pnpm run test:fhir`
- `pnpm exec playwright install chromium` then `pnpm run test:fhir:browser`

The browser tests run the actual normalizer in Chromium with synthetic inputs. They do not use invented EHR routes or claim database/UI end-to-end coverage. Their standalone configuration leaves the existing authenticated EHR suite unchanged.

## Contract

`artifacts/api-server/src/fhir/practitioner-role.ts` exports `normalizePractitionerRole(payload, dependencies)` and structured `PractitionerRoleValidationError` errors with `code` and `field`.

Pass a trusted, versioned NUCC membership function through `taxonomyExists` and record its release in `taxonomyVersion`. The caller must check the code's effective status in that release. Lookup outages propagate to the caller rather than being misreported as invalid provider input. The small test code list is synthetic test infrastructure only; it is not the production taxonomy catalog.

This adapter implements the requested directory contract requiring a checksum-valid NPI in `PractitionerRole.identifier`, selected by the exact NPI system URI. Conflicting identifiers are rejected. This is stricter than base FHIR: role identifiers identify roles, and a directory may supply the practitioner's NPI in a linked Practitioner instead. Such feeds need an explicit reference-resolution adapter before this boundary; do not fetch arbitrary external references from the payload.

NUCC coding is selected from each specialty concept; multiple specialties are retained. Work emails and work phones stay separate and preserve multiple entries. Missing/null optional collections become empty arrays, null contact/service members are skipped, and non-array structures generate controlled errors. Qualification is ignored with an empty compatibility default because it belongs to Practitioner. The returned object is an internal DTO, deliberately labeled `sourceResourceType`; it is not a FHIR resource to export.

NPI checksum validation does not verify issuance, ownership, enrollment, or credentialing. Null-tolerant normalization is a directory adapter policy, not a claim that null collections are valid FHIR JSON.

## Live integration still required

The inspected main branch has no PractitionerRole ingestion endpoint, role persistence model, or NUCC reference dataset. Before enabling imports:

1. Load and verify an official versioned NUCC release and connect the lookup.
2. Implement an authenticated, tenant-authorized import service with atomic storage, source provenance, and duplicate protection. Persist role-specific multi-value contacts rather than overwriting the provider's single email/phone fields.
3. Map controlled validation errors to a 4xx OperationOutcome; treat lookup outages separately. Never expose raw infrastructure errors.
4. Add synthetic-tenant API/database/browser end-to-end tests covering authorization, cross-tenant denial, invalid input, persistence, retry, and display.

No production data, schema, API routes, or UI behavior are changed by this commit.

References:
- https://hl7.org/fhir/R4/practitionerrole.html
- https://hl7.org/fhir/R4/practitioner.html
- https://www.nucc.org/index.php/code-sets-mainmenu-41/provider-taxonomy-mainmenu-40

Verification in implementation environment: 52 Node tests passed; strict TypeScript checking passed for the module and test files. Playwright discovers all three cases, but browser execution is blocked because Chromium downloads return an invalid/truncated archive. No browser pass or full application build is claimed.
