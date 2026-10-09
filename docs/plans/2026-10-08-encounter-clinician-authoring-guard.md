# Encounter Clinician Authoring Guard

## Goal
Prevent a user from entering clinical documentation and only discovering at signature time that the account is not an authorized clinician for the encounter.

## Approved behavior
- Practice Admins may continue scheduling appointments.
- Clinical note authoring requires a Clinician role.
- The logged-in clinician must be linked to the encounter rendering provider.
- A clinician with no provider link may be linked automatically through the existing safe provider-link RPC before note editing begins.
- A clinician already linked to another provider must be blocked from editing/signing an encounter assigned to a different rendering provider.
- Signature validation remains a final server-side safeguard.
- The signature area is not the normal place to discover or repair clinician identity.

## Implementation
1. Add a pure encounter-authoring access decision helper and regression tests covering admin-only, clinician-only, admin+clinician, missing provider link, and provider mismatch.
2. Resolve clinician/provider identity as the encounter loads using existing readiness/link RPCs.
3. Keep the clinical editor read-only until authoring access is ready; block draft save and sign handlers when not ready.
4. Remove the normal signature-stage manual link prompt from the encounter page.
5. Tighten `sign_encounter` so Practice Admin status alone does not authorize a clinical signature.
6. Run lint, typecheck, encounter tests, full tests, and SQL migration checks through repository CI before merge.
