-- Recovered from production migration history; already applied.

alter view public.v_fee_schedule_rates set (security_invoker = true);
alter view public.reference_library_status set (security_invoker = true);
