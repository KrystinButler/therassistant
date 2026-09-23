
revoke execute on function public.rcm_create_claim_from_charges(uuid, uuid[]) from public;
revoke execute on function public.rcm_create_claim_from_charges(uuid, uuid[]) from anon;
grant execute on function public.rcm_create_claim_from_charges(uuid, uuid[]) to authenticated;

revoke execute on function public.rcm_validate_claim(uuid) from public;
revoke execute on function public.rcm_validate_claim(uuid) from anon;
grant execute on function public.rcm_validate_claim(uuid) to authenticated;

revoke execute on function public.rcm_create_claim_batch(uuid, uuid[], text) from public;
revoke execute on function public.rcm_create_claim_batch(uuid, uuid[], text) from anon;
grant execute on function public.rcm_create_claim_batch(uuid, uuid[], text) to authenticated;

revoke execute on function public.rcm_record_external_submission(uuid, uuid, text, text) from public;
revoke execute on function public.rcm_record_external_submission(uuid, uuid, text, text) from anon;
grant execute on function public.rcm_record_external_submission(uuid, uuid, text, text) to authenticated;

revoke execute on function public.rcm_record_external_acknowledgement(uuid, uuid, uuid, text, text, text, text, text) from public;
revoke execute on function public.rcm_record_external_acknowledgement(uuid, uuid, uuid, text, text, text, text, text) from anon;
grant execute on function public.rcm_record_external_acknowledgement(uuid, uuid, uuid, text, text, text, text, text) to authenticated;
