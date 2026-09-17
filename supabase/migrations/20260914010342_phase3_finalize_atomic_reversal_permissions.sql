-- Final Phase 3 reversal hardening.
-- This migration intentionally runs after every 20260913 Phase 3 permission migration
-- so a clean replay cannot restore direct anonymous reversal writes.

revoke update on table public.payment_allocations from anon;
revoke update (reversed_at) on table public.payment_allocations from anon;
revoke insert on table public.payment_reversals from anon;

drop policy if exists "demo anon payment allocations update" on public.payment_allocations;
drop policy if exists "demo anon payment reversals insert" on public.payment_reversals;
