drop table public.claim_notes restrict;
drop table public.account_notes restrict;

drop type public.note_visibility_enum;
drop type public.note_type_enum;

notify pgrst, 'reload schema';
