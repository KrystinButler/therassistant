-- Private-pay, program billing, and held uninsured charges intentionally have no payer.
-- Match the canonical charge schema; insurance claims retain RPC payer validation.
alter table public.charge_capture_items alter column payer_id drop not null;
notify pgrst, 'reload schema';
