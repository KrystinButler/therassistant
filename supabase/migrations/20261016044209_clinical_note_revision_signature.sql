create or replace function public.sign_encounter_note_revision(
  p_encounter_id uuid, p_note_id uuid, p_provider_id uuid,
  p_signature_text text, p_expected_note_text text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_note public.clinical_notes%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into v_note from public.clinical_notes
  where id=p_note_id and encounter_id=p_encounter_id for update;
  if not found then raise exception 'Clinical note not found'; end if;
  perform public.assert_tenant_access(v_note.tenant_id);
  if v_note.note_text is distinct from p_expected_note_text then
    raise exception 'The saved note changed before signing. Review the current version before retrying.' using errcode='40001';
  end if;
  return public.sign_encounter_note(p_encounter_id,p_note_id,p_provider_id,p_signature_text);
end;
$$;
revoke all on function public.sign_encounter_note_revision(uuid,uuid,uuid,text,text) from public, anon;
grant execute on function public.sign_encounter_note_revision(uuid,uuid,uuid,text,text) to authenticated;
