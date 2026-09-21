# Therassistant CRM Production Checklist

Date: 2026-09-21
Branch: `feature/therassistant-crm`
Pull request: #68

## Verification

- [x] Full repository test suite passes on the CRM branch.
- [x] Production TypeScript gate passes.
- [x] Browser secret scan passes.
- [x] Production Vite build passes.
- [x] SPA route smoke tests pass.
- [x] Browser E2E passes.
- [x] Vercel preview deployment for commit `33b3fc20010603ab6f8f1b6644d601dfc78ecd88` is READY.
- [x] Supabase rollback-only database verification passed for:
  - atomic payment-plan creation;
  - atomic payment-plan modification;
  - payment-plan version preservation;
  - multi-installment oldest-due allocation;
  - overpayment left unallocated as credit;
  - sandbox payment rejection from real installment allocation.

## Data and security boundary

- [x] CRM tables use RLS and direct browser table access is revoked.
- [x] CRM access is authorized from `payment_desk_users`, not user-editable JWT metadata.
- [x] Admin-only account lifecycle and original-balance mutation are enforced by the backend.
- [x] CRM documents are stored in the private `crm-documents` bucket.
- [x] Document upload finalization verifies the uploaded object exists and matches the expected byte size.
- [x] Document downloads use short-lived signed URLs.
- [x] PAN and CVV are not persisted.
- [x] Square secrets remain server-side in Edge Function environment variables.
- [x] Sandbox Square transactions do not reduce real CRM balances or alter real installment schedules.
- [x] Payment allocation uses one atomic database RPC and is idempotent by transaction/activity record.
- [x] Only one open payment plan can exist per account.
- [x] New and materially modified plans remain draft until a signed agreement is uploaded.
- [x] Signed agreement upload activates the plan.
- [x] Direct API attempts to mark an agreement signed without an uploaded signed document are rejected.
- [x] Account overpayments display as account credit rather than being forced into installments.
- [x] Obsolete public Supabase Payment Desk hosting/diagnostic functions were replaced with inert 404 handlers.

## Initial account migration

- [x] Brandon/Inner Space Psychiatry is seeded as internal account `CRM-000001`.
- [x] Original principal is `$11,081.25`.
- [x] Historical accrued interest is documented but is not silently added to the CRM original balance.
- [x] The two existing $1 Square sandbox test transactions remain unlinked.
- [x] Brandon currently has zero linked production payments and a starting CRM balance of `$11,081.25`.

## Supabase deployment

- [x] `crm-api` is ACTIVE.
- [x] `payment-desk-api` is ACTIVE.
- [x] `crm-documents` bucket is private.
- [x] Database migrations for CRM schema, account numbering, Square-environment tracking, seed data, atomic plan lifecycle, and atomic payment allocation are applied.
- [x] Supabase security advisor has no CRM Critical findings.
- [x] RLS-without-policy INFO findings are intentional because CRM tables are service-role-only behind authenticated Edge Functions.
- [ ] Supabase leaked-password protection remains an account-level Auth advisory and should be enabled in the Supabase Auth dashboard when convenient; it was not introduced by the CRM feature.

## Square / live-payment readiness

- [x] Manual keyed card flow uses Square Web Payments secure fields.
- [x] Square-hosted payment-link creation and refresh are implemented.
- [x] Payment replay uses idempotency keys.
- [x] Completed payment-link payments are imported once and allocated once.
- [x] Square environment is stored with every CRM-linked transaction/payment link.
- [ ] Before processing Brandon's real card, replace sandbox Square credentials with the matching production Application ID, Location ID, access token, and `SQUARE_ENV=production`. Do not mix sandbox and production credentials.

## Deployment / compatibility

- [x] CRM is isolated under `/crm` and does not enter the EHR TenantGate.
- [x] Existing `/payment-desk` routing is preserved.
- [x] Current Vercel preview is READY.
- [x] GitHub CI verifies both CRM and existing Therassistant application behavior.
- [ ] Production Vercel deployment occurs only after the CRM branch is merged to `main`.

## Final integration gate

The implementation is ready for integration when the current branch remains green. Production deployment is intentionally left to the branch integration decision; the user must choose whether to merge, keep the pull request, or preserve the branch.
