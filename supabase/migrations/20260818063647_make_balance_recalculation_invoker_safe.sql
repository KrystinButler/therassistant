alter function public.recalculate_claim_balance_summary(uuid) security invoker;
alter function public.recalculate_claim_balance_summary(uuid) set search_path = public, pg_temp;

alter function public.recalculate_client_balance_summary(uuid) security invoker;
alter function public.recalculate_client_balance_summary(uuid) set search_path = public, pg_temp;

revoke execute on function public.recalculate_claim_balance_summary(uuid) from public, anon;
revoke execute on function public.recalculate_client_balance_summary(uuid) from public, anon;
grant execute on function public.recalculate_claim_balance_summary(uuid) to authenticated;
grant execute on function public.recalculate_client_balance_summary(uuid) to authenticated;
