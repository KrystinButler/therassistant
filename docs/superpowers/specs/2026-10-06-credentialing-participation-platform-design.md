# Credentialing Participation Platform Design

**Source of truth:** User-supplied `SPEC-1-Colorado Mental Health Provider Credentialing & Payer Participation Verification`, October 6, 2026.

## Goal

Finish Therassistant Credentialing as a standalone module boundary for Colorado mental-health providers and staff. A user selects a provider, practice/group, location, payer, plan/product, and network; requests participation verification; and receives an evidence-backed `PARTICIPATING`, `NOT_FOUND`, or `UNABLE_TO_VERIFY` result with immutable history.

## Non-negotiable boundaries

1. Credentialing has **zero authority over claims**. It may never stop, hold, edit, route, validate, or otherwise gate a claim.
2. Provider-directory verification is evidence of directory/network participation only. It is not proof of credentialing, contracting, billability, eligibility, benefits, or reimbursement.
3. `NOT_FOUND` means a qualifying record was not found after a successful authoritative search. It must never be translated to `OUT_OF_NETWORK` or `non_participating`.
4. Source/API failures produce `UNABLE_TO_VERIFY`, never `NOT_FOUND`.
5. No patient/member data belongs in the credentialing participation-verification domain.
6. Name-only or fuzzy matching may locate candidates but can never independently produce `PARTICIPATING`.
7. Historical verification evidence is immutable from the application perspective.
8. Tenant-owned records require RLS and cross-tenant isolation tests.

## Existing-stack adaptation

SPEC-1 proposes a modular monolith with background workers. The current Therassistant repository already supplies React/TypeScript, Express, PostgreSQL through Supabase, authentication/tenant context, Vercel deployment, and an existing credentialing domain. Replatforming to Next.js, Redis, BullMQ, or a second database would add cost and migration risk without changing the required business behavior.

The implementation therefore keeps the existing stack and maps the specification as follows:

- Web UI: existing React credentialing module under its independent `CredentialingModuleApp` shell.
- REST API: existing Express API, extended with versioned `/api/v1` credentialing endpoints.
- Database/auth/RLS: existing Supabase Postgres/Auth and tenant access helpers.
- Queue: Supabase Queues (`pgmq`) behind a small application queue adapter.
- Scheduler: Supabase Cron (`pg_cron`) for catalog/directory refresh scheduling where needed.
- Worker: existing server/worker patterns or a JWT-protected Supabase Edge Function consumer, whichever matches the repository's deployed worker boundary after verification.
- Hosting: existing Vercel project for the web/API preview. No new paid infrastructure is required.

The module remains independently routable and API-driven so it can later be deployed separately from the EHR without redesigning its business model.

## Domain ownership

### EHR core owns

- Provider identity used by clinical/billing workflows: provider ID, name, Type 1 NPI, taxonomy, role/status.
- Clinical, charge, claim, payment, and patient domains.

### Credentialing owns

- Credentialing applications and requirements.
- Provider-payer enrollment records.
- Practice/entity and provider-location participation context.
- Payer contracts/resources used by credentialing.
- Payer/plan/network catalog metadata for participation verification.
- Directory observations, synchronization metadata, discrepancies, verification runs, evidence, adapter health, and audit events.

Credentialing can link back to a provider by immutable provider ID. Claims cannot depend on credentialing state.

## Provider/practice/location model

Reuse the existing `providers`, `practice_entities`, `practice_locations`, `provider_locations`, and existing provider/entity NPI fields rather than introducing duplicate provider tables.

Verification context requires:

- Type 1 NPI from `providers.individual_npi`.
- Type 2/group NPI from `practice_entities.group_npi`.
- provider-to-location relation from `provider_locations`.
- Colorado location information from `practice_locations`.
- taxonomy from provider and/or location as supporting evidence.

## Payer catalog

Reuse `payers` and `payer_plans`; extend the reference model rather than duplicating it.

Add:

- payer adapter key and effective dates.
- external plan identifier, product/market segment, state, effective dates, source timestamp.
- `payer_networks` with external network ID, plan relationship, effective dates, and source timestamp.
- `payer_coverage_areas` / effective-dated regional relationships needed for Colorado Medicaid.
- `payer_catalog_syncs` for source/version/checksum/change counts/error summary.

Catalog records are deactivated/effective-dated instead of physically deleted when a source retires them.

Colorado ACC Phase III is modeled as effective-dated reference data, including Region 1/RMHP, Region 2/Northeast Health Partners, Region 3/CCHA, and Region 4/Colorado Access, while permitting RMHP PRIME, Denver Health Medicaid Choice, and future region changes.

## Automated verification model

Keep existing `participation_verifications` as the manual credentialing-history record because it currently uses the enrollment/network participation status enum and is integrated with existing credentialing workflows.

Add a separate automated-verification model:

- `participation_verification_runs`
  - tenant/provider/entity/location/payer/plan/network context
  - status: `IN_PROGRESS | PARTICIPATING | NOT_FOUND | UNABLE_TO_VERIFY`
  - confidence: `HIGH | MEDIUM | LOW`
  - source type/reference/timestamps
  - requested/completed/verified timestamps
  - adapter/matcher versions
  - requester/audit context
  - error classification/detail
- `participation_verification_matches`
  - immutable expected/observed evidence by match type
  - matched flag and explanatory score
  - source reference
- `payer_adapter_health`
  - adapter key, last success/failure, health state, source freshness, error summary
- optional normalized `payer_directory_entries` and `payer_directory_syncs` for sources that are ingested rather than queried live.

This separation prevents automated `NOT_FOUND` from mutating the practice's manually maintained credentialing or network-participation status.

## Adapter contract

Every payer adapter implements a common interface equivalent to:

```ts
interface PayerAdapter {
  key: string;
  syncCatalog(): Promise<CatalogSyncResult>;
  verifyParticipation(request: VerificationRequest): Promise<PayerEvidence>;
  healthCheck(): Promise<AdapterHealth>;
}
```

Source priority:

1. Official payer Provider Directory API.
2. Official government/payer machine-readable directory.
3. Official downloadable directory dataset.
4. Other permitted automated payer mechanism.
5. Controlled official manual-directory fallback.

Unsupported scraping is prohibited.

Initial source roles:

- NPPES: provider identity/taxonomy/location evidence, not network participation.
- CMS PECOS FFS enrollment file: Medicare enrollment evidence, not a substitute for MA plan/network evidence.
- Health First Colorado/RAEs: state and RAE/network evidence kept distinct.
- Cigna/Anthem: Plan-Net/FHIR where a current official endpoint permits it.
- Aetna: official API when authenticated access is configured; otherwise controlled fallback.
- UHC: normalized ingestion of applicable machine-readable Colorado provider-directory data when feasible.
- TRICARE West/TriWest: supported official directory/data mechanism; otherwise controlled fallback.

Each target payer must either return reproducible automated evidence or a clear `UNABLE_TO_VERIFY` result with an official fallback path.

## Matching rules

Deterministic matching order:

1. Exact Type 1 NPI.
2. Correct payer.
3. Correct selected plan/product.
4. Correct selected network when network is required.
5. Type 2/group affiliation evidence when selected.
6. Colorado location evidence.
7. Behavioral-health taxonomy evidence.
8. Conflict resolution.

`PARTICIPATING` requires the authoritative evidence required for the selected plan/network. A numeric score cannot compensate for missing plan/network evidence.

`NOT_FOUND` is allowed only when an authoritative source was successfully searched and no qualifying participation record was found.

All source failures, ambiguous results, missing required source configuration, and unsupported source mechanisms produce `UNABLE_TO_VERIFY`.

## Asynchronous workflow

1. `POST /api/v1/participation-verifications` validates tenant/provider/entity/location/payer/plan/network context.
2. API inserts an immutable run in `IN_PROGRESS`.
3. API enqueues a `credentialing-participation-verification` message and returns HTTP 202 with the verification ID.
4. Worker reads the message with a visibility timeout, calls the selected adapter(s), normalizes evidence, applies the deterministic matcher, stores evidence/result, writes audit history, and archives the message.
5. UI polls `GET /api/v1/participation-verifications/:id` until terminal.
6. Verification history/evidence remains queryable and reproducible.

Retries use bounded exponential backoff for transient errors only. Permanent/configuration errors are not blindly retried.

## REST surface

Versioned credentialing endpoints:

- provider/practice/location reads needed by standalone credentialing UI.
- `GET /api/v1/payers`
- `GET /api/v1/payers/:payerId/plans`
- `GET /api/v1/plans/:planId/networks`
- `POST /api/v1/participation-verifications` -> 202
- `GET /api/v1/participation-verifications/:id`
- `GET /api/v1/providers/:providerId/participation`
- `GET /api/v1/providers/:providerId/verification-history`
- adapter health and controlled refresh endpoints restricted to authorized staff/admin flows.

Legacy credentialing application/enrollment APIs continue to work but remain separate from the automated participation result.

## User experience

The credentialing module adds a dedicated **Verify Participation** workflow with these required inputs:

- Provider
- Practice/group
- Location
- Payer
- Plan/product
- Network when applicable

The result view shows:

- Participating / Not Found / Unable to Verify
- confidence
- Type 1 NPI evidence
- Type 2/group evidence
- location evidence
- plan/network evidence
- taxonomy evidence
- source freshness
- verification timestamp
- View Evidence
- official fallback link for unable/ambiguous sources

`Not Found` always includes the explicit statement that it does not establish out-of-network status.

## Security and audit

- RLS on every tenant-owned public table.
- Shared payer catalog is authenticated read-only from the browser; writes occur only through trusted server/admin paths.
- Queue internals are not exposed to public browser clients.
- Application authorization + database RLS defense in depth.
- Cross-tenant tests cover reads and writes.
- Audit events include verification requested/completed/evidence viewed/catalog synchronized/adapter configuration changed.
- Raw source evidence is minimized and retained only where permitted; no patient data is collected.

## Release gate

Before PR #162 can leave draft:

1. Unit/matcher/adapter contract tests pass.
2. RLS/cross-tenant tests pass.
3. Versioned API integration tests pass.
4. Credentialing UI E2E path passes.
5. Existing note -> charge -> claim and revenue-cycle regression suites pass with credentialing unavailable, missing, stale, and `NOT_FOUND`.
6. Full TypeScript/build passes.
7. Supabase security and performance advisors are reviewed after DDL.
8. Vercel preview reaches READY and smoke tests pass.
9. No production promotion occurs if tenant-isolation or claim-isolation checks fail.
