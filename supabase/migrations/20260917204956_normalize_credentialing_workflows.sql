drop view if exists public.v_credentialing_case_summary;
drop view if exists public.v_provider_enrollment_matrix;

alter type public.workqueue_source_object_type_enum add value if not exists 'provider_payer_enrollment';
alter type public.workqueue_source_object_type_enum add value if not exists 'credentialing_application';
alter type public.workqueue_source_object_type_enum add value if not exists 'provider_network_participation';
alter type public.workqueue_source_object_type_enum add value if not exists 'provider_credential';
alter type public.workqueue_source_object_type_enum add value if not exists 'roster_action';

alter table public.credentialing_document_links
  add column if not exists verification_id uuid references public.participation_verifications(id) on delete cascade;

create index if not exists idx_credentialing_document_links_verification_id
  on public.credentialing_document_links(verification_id);

drop table if exists public.participation_evidence;
drop table if exists public.credentialing_issues;

alter table public.credentialing_application_events
  drop column if exists from_status,
  drop column if exists to_status;

alter table public.credentialing_applications
  drop column if exists effective_date,
  drop column if exists last_contact_date,
  drop column if exists next_followup_date;

alter table public.provider_payer_enrollments
  drop column if exists submitted_date,
  drop column if exists approved_date,
  drop column if exists last_verified_at;

alter table public.provider_network_participation
  drop column if exists last_verified_at;

create or replace function public.log_credentialing_application_status_change()
returns trigger
language plpgsql
set search_path = 'public', 'auth', 'pg_temp'
as $$
begin
  if old.status is distinct from new.status then
    insert into public.status_history (
      tenant_id,
      target_type,
      target_id,
      old_status,
      new_status,
      changed_by,
      reason
    ) values (
      new.tenant_id,
      'credentialing_application',
      new.id,
      old.status::text,
      new.status::text,
      auth.uid(),
      'Credentialing application status updated'
    );
  end if;
  return new;
end;
$$;

revoke all on function public.log_credentialing_application_status_change() from public;
revoke all on function public.log_credentialing_application_status_change() from anon;
revoke all on function public.log_credentialing_application_status_change() from authenticated;

drop trigger if exists trg_credentialing_application_status_history on public.credentialing_applications;
create trigger trg_credentialing_application_status_history
after update of status on public.credentialing_applications
for each row
execute function public.log_credentialing_application_status_change();

comment on table public.credentialing_application_events is
  'User-facing non-status credentialing timeline events. Status changes belong in status_history; payer contacts belong in credentialing_followups.';

comment on table public.credentialing_followups is
  'Structured payer-contact history for credentialing applications. The latest row is the source of truth for last contact and next follow-up date.';

comment on table public.workqueue_items is
  'System-wide task and issue workflow. Credentialing issues are represented here rather than in a separate credentialing issue table.';

comment on table public.credentialing_document_links is
  'Single document-link mechanism for credentialing records, including providers, credentials, enrollments, applications, participation, verifications, and contracts.';

comment on table public.provider_network_participation is
  'Current network-participation state. Verification history is stored in participation_verifications and last verification is derived from that history.';

create view public.v_provider_enrollment_matrix
with (security_invoker = true)
as
select
  ppe.tenant_id,
  ppe.id as enrollment_id,
  ppe.enrollment_status,
  ppe.effective_date,
  ppe.termination_date,
  ppe.payer_provider_id,
  ppe.notes,
  pr.id as provider_id,
  concat_ws(' ', pr.first_name, pr.last_name) as provider_name,
  pr.credentials,
  pr.individual_npi,
  py.id as payer_id,
  py.name as payer_name,
  ppe.updated_at,
  pp.id as payer_plan_id,
  pp.name as payer_plan_name,
  pe.id as practice_entity_id,
  pe.legal_name as practice_entity_name,
  pl.id as practice_location_id,
  pl.name as practice_location_name,
  pc.id as payer_contract_id,
  pc.contract_name,
  pnp.participation_status,
  pnp.directory_status,
  ver.last_verified_at as participation_last_verified_at,
  ppe.revalidation_due_date
from public.provider_payer_enrollments ppe
join public.providers pr on pr.id = ppe.provider_id
join public.payers py on py.id = ppe.payer_id
left join public.payer_plans pp on pp.id = ppe.payer_plan_id
left join public.practice_entities pe on pe.id = ppe.practice_entity_id
left join public.practice_locations pl on pl.id = ppe.practice_location_id
left join public.payer_contracts pc on pc.id = ppe.payer_contract_id
left join public.provider_network_participation pnp on pnp.enrollment_id = ppe.id
left join lateral (
  select max(pv.verified_at) as last_verified_at
  from public.participation_verifications pv
  where pv.participation_id = pnp.id
) ver on true;

create view public.v_credentialing_case_summary
with (security_invoker = true)
as
select
  ca.tenant_id,
  ca.id as application_id,
  ca.status as application_status,
  ca.application_type,
  ca.application_reference,
  ca.submitted_date,
  ca.payer_received_date,
  ca.decision_date,
  ppe.effective_date as enrollment_effective_date,
  fu.last_contact_date,
  fu.next_followup_date,
  ca.priority,
  ca.assigned_user_id,
  ca.updated_at,
  ppe.id as enrollment_id,
  ppe.enrollment_status,
  ppe.payer_provider_id,
  ppe.revalidation_due_date,
  pr.id as provider_id,
  concat_ws(' ', pr.first_name, pr.last_name) as provider_name,
  pr.credentials,
  pr.individual_npi,
  py.id as payer_id,
  py.name as payer_name,
  pp.id as payer_plan_id,
  pp.name as payer_plan_name,
  pe.id as practice_entity_id,
  pe.legal_name as practice_entity_name,
  pl.id as practice_location_id,
  pl.name as practice_location_name,
  pc.id as payer_contract_id,
  pc.contract_name,
  pnp.id as participation_id,
  pnp.participation_status,
  pnp.directory_status,
  ver.last_verified_at as participation_last_verified_at,
  (current_date - ca.created_at::date) as application_age_days,
  coalesce(req.missing_requirements, 0::bigint) as missing_requirements
from public.credentialing_applications ca
join public.provider_payer_enrollments ppe on ppe.id = ca.enrollment_id
join public.providers pr on pr.id = ppe.provider_id
join public.payers py on py.id = ppe.payer_id
left join public.payer_plans pp on pp.id = ppe.payer_plan_id
left join public.practice_entities pe on pe.id = ppe.practice_entity_id
left join public.practice_locations pl on pl.id = ppe.practice_location_id
left join public.payer_contracts pc on pc.id = ppe.payer_contract_id
left join public.provider_network_participation pnp on pnp.enrollment_id = ppe.id
left join lateral (
  select
    cf.followup_date as last_contact_date,
    cf.next_followup_date
  from public.credentialing_followups cf
  where cf.application_id = ca.id
  order by cf.followup_date desc, cf.created_at desc
  limit 1
) fu on true
left join lateral (
  select max(pv.verified_at) as last_verified_at
  from public.participation_verifications pv
  where pv.participation_id = pnp.id
) ver on true
left join lateral (
  select count(*) filter (
    where cr.status = any (array[
      'missing'::public.credentialing_requirement_status_enum,
      'requested'::public.credentialing_requirement_status_enum
    ])
  ) as missing_requirements
  from public.credentialing_requirements cr
  where cr.application_id = ca.id
) req on true;
