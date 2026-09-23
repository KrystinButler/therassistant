
create or replace function public.rcm_record_external_acknowledgement(
  p_tenant_id uuid,
  p_submission_id uuid,
  p_claim_id uuid,
  p_outcome text,
  p_acknowledgement_type text,
  p_response_code text,
  p_response_message text,
  p_external_reference text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_submission public.claim_submissions%rowtype;
  v_claim public.professional_claims%rowtype;
  v_now timestamptz := now();
  v_total_claims integer := 0;
  v_responded integer := 0;
  v_accepted integer := 0;
  v_rejected integer := 0;
  v_submission_status public.submission_status_enum;
  v_batch_status public.claim_batch_status_enum;
begin
  perform public.assert_tenant_access(p_tenant_id);

  if p_outcome not in ('accepted','rejected') then
    raise exception 'Acknowledgement outcome must be accepted or rejected.';
  end if;
  if nullif(trim(p_response_code), '') is null then
    raise exception 'Acknowledgement response code is required.';
  end if;
  if nullif(trim(p_response_message), '') is null then
    raise exception 'Acknowledgement response message is required.';
  end if;
  if nullif(trim(p_external_reference), '') is null then
    raise exception 'Acknowledgement external reference is required.';
  end if;

  select *
    into v_submission
  from public.claim_submissions
  where tenant_id = p_tenant_id
    and id = p_submission_id
  for update;

  if not found then
    raise exception 'Claim submission not found.';
  end if;

  select *
    into v_claim
  from public.professional_claims
  where tenant_id = p_tenant_id
    and id = p_claim_id
  for update;

  if not found then
    raise exception 'Claim not found.';
  end if;

  if v_submission.batch_id is not null then
    if not exists (
      select 1
      from public.claim_batch_items
      where tenant_id = p_tenant_id
        and batch_id = v_submission.batch_id
        and claim_id = p_claim_id
    ) then
      raise exception 'The selected claim does not belong to this submission batch.';
    end if;
  elsif v_submission.claim_id is distinct from p_claim_id then
    raise exception 'The selected claim does not belong to this submission.';
  end if;

  if v_claim.claim_status not in (
    'submitted'::public.claim_status_enum,
    'accepted'::public.claim_status_enum,
    'rejected'::public.claim_status_enum
  ) then
    raise exception 'Claim cannot receive an acknowledgement from status %.', v_claim.claim_status;
  end if;

  if exists (
    select 1
    from public.submission_responses sr
    where sr.tenant_id = p_tenant_id
      and sr.submission_id = p_submission_id
      and sr.claim_id = p_claim_id
      and sr.response_status = p_outcome::public.submission_status_enum
      and coalesce(sr.response_code,'') = trim(p_response_code)
      and coalesce(sr.raw_response->>'external_reference','') = trim(p_external_reference)
  ) then
    raise exception 'This acknowledgement has already been recorded for the claim.';
  end if;

  insert into public.submission_responses (
    tenant_id,
    submission_id,
    claim_id,
    response_status,
    response_code,
    response_message,
    raw_response
  ) values (
    p_tenant_id,
    p_submission_id,
    p_claim_id,
    p_outcome::public.submission_status_enum,
    trim(p_response_code),
    trim(p_response_message),
    jsonb_build_object(
      'source','external_acknowledgement',
      'acknowledgement_type',coalesce(nullif(trim(p_acknowledgement_type),''),'other'),
      'external_reference',trim(p_external_reference),
      'recorded_at',v_now
    )
  );

  update public.professional_claims
  set claim_status = p_outcome::public.claim_status_enum,
      accepted_at = case when p_outcome = 'accepted' then v_now else null end,
      updated_at = v_now
  where tenant_id = p_tenant_id
    and id = p_claim_id;

  insert into public.claim_status_history (
    tenant_id,
    claim_id,
    old_status,
    new_status,
    changed_by,
    reason
  ) values (
    p_tenant_id,
    p_claim_id,
    v_claim.claim_status,
    p_outcome::public.claim_status_enum,
    auth.uid(),
    coalesce(nullif(trim(p_acknowledgement_type),''),'other')
      || ' acknowledgement recorded: '
      || trim(p_response_code)
      || ' — '
      || trim(p_response_message)
  );

  if p_outcome = 'rejected' and not exists (
    select 1
    from public.workqueue_items wq
    where wq.tenant_id = p_tenant_id
      and wq.source_object_type = 'claim'::public.workqueue_source_object_type_enum
      and wq.source_object_id = p_claim_id
      and wq.workqueue_type = 'claim_rejection'::public.workqueue_type_enum
      and wq.workqueue_status in (
        'open'::public.workqueue_status_enum,
        'in_progress'::public.workqueue_status_enum,
        'pending'::public.workqueue_status_enum,
        'snoozed'::public.workqueue_status_enum,
        'reopened'::public.workqueue_status_enum
      )
  ) then
    perform public.create_workqueue_item(
      p_tenant_id,
      'claim_rejection'::public.workqueue_type_enum,
      'claim'::public.workqueue_source_object_type_enum,
      p_claim_id,
      'Clearinghouse rejection requires correction',
      coalesce(nullif(trim(p_acknowledgement_type),''),'other')
        || ' '
        || trim(p_response_code)
        || '. '
        || trim(p_response_message),
      'high'::public.workqueue_priority_enum,
      current_date + 1,
      null
    );
  elsif p_outcome = 'accepted' then
    update public.workqueue_items
    set workqueue_status = 'completed'::public.workqueue_status_enum,
        completed_at = coalesce(completed_at, v_now),
        updated_at = v_now
    where tenant_id = p_tenant_id
      and source_object_type = 'claim'::public.workqueue_source_object_type_enum
      and source_object_id = p_claim_id
      and workqueue_type = 'claim_rejection'::public.workqueue_type_enum
      and workqueue_status in (
        'open'::public.workqueue_status_enum,
        'in_progress'::public.workqueue_status_enum,
        'pending'::public.workqueue_status_enum,
        'snoozed'::public.workqueue_status_enum,
        'reopened'::public.workqueue_status_enum
      );
  end if;

  if v_submission.batch_id is not null then
    select count(*)
      into v_total_claims
    from public.claim_batch_items
    where tenant_id = p_tenant_id
      and batch_id = v_submission.batch_id;
  else
    v_total_claims := 1;
  end if;

  with latest as (
    select distinct on (sr.claim_id)
      sr.claim_id,
      sr.response_status
    from public.submission_responses sr
    where sr.tenant_id = p_tenant_id
      and sr.submission_id = p_submission_id
      and sr.claim_id is not null
    order by sr.claim_id, sr.created_at desc, sr.id desc
  )
  select
    count(*),
    count(*) filter (where response_status = 'accepted'::public.submission_status_enum),
    count(*) filter (where response_status = 'rejected'::public.submission_status_enum)
  into v_responded, v_accepted, v_rejected
  from latest;

  v_submission_status := case
    when v_responded < v_total_claims then 'pending_response'::public.submission_status_enum
    when v_accepted = v_total_claims then 'accepted'::public.submission_status_enum
    else 'rejected'::public.submission_status_enum
  end;

  update public.claim_submissions
  set submission_status = v_submission_status,
      response_payload = coalesce(response_payload,'{}'::jsonb) || jsonb_build_object(
        'latest_acknowledgement_type',coalesce(nullif(trim(p_acknowledgement_type),''),'other'),
        'latest_external_reference',trim(p_external_reference),
        'latest_response_code',trim(p_response_code),
        'responded_claim_count',v_responded,
        'total_claim_count',v_total_claims
      ),
      updated_at = v_now
  where tenant_id = p_tenant_id
    and id = p_submission_id;

  if v_submission.batch_id is not null then
    v_batch_status := case
      when v_responded < v_total_claims then 'submitted'::public.claim_batch_status_enum
      when v_accepted = v_total_claims then 'accepted'::public.claim_batch_status_enum
      when v_rejected = v_total_claims then 'rejected'::public.claim_batch_status_enum
      else 'partially_accepted'::public.claim_batch_status_enum
    end;

    update public.claim_batches
    set batch_status = v_batch_status,
        updated_at = v_now
    where tenant_id = p_tenant_id
      and id = v_submission.batch_id;
  end if;

  return jsonb_build_object(
    'submission_id',p_submission_id,
    'claim_id',p_claim_id,
    'outcome',p_outcome,
    'submission_status',v_submission_status,
    'responded_claim_count',v_responded,
    'total_claim_count',v_total_claims
  );
end;
$function$;

revoke execute on function public.rcm_record_external_acknowledgement(uuid, uuid, uuid, text, text, text, text, text) from anon;
grant execute on function public.rcm_record_external_acknowledgement(uuid, uuid, uuid, text, text, text, text, text) to authenticated;
