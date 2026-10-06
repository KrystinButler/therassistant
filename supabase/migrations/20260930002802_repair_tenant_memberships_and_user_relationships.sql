insert into public.tenant_users (
  tenant_id,
  user_id,
  status,
  joined_at
)
select
  tur.tenant_id,
  tur.user_id,
  'active'::public.user_status_enum,
  min(tur.created_at)
from public.tenant_user_roles tur
join public.tenants t
  on t.id = tur.tenant_id
 and t.status = 'active'::public.tenant_status_enum
join auth.users au
  on au.id = tur.user_id
 and au.deleted_at is null
join public.user_profiles up
  on up.id = tur.user_id
 and up.status = 'active'::public.user_status_enum
left join public.tenant_users tu
  on tu.tenant_id = tur.tenant_id
 and tu.user_id = tur.user_id
where tu.id is null
group by tur.tenant_id, tur.user_id
on conflict (tenant_id, user_id) do nothing;

alter table public.credentialing_applications
  add constraint credentialing_applications_assigned_user_id_fkey
  foreign key (assigned_user_id)
  references auth.users(id)
  on delete set null;

alter table public.roster_actions
  add constraint roster_actions_assigned_user_id_fkey
  foreign key (assigned_user_id)
  references auth.users(id)
  on delete set null;

alter table public.portal_message_threads
  add constraint portal_message_threads_created_by_patient_user_id_fkey
  foreign key (created_by_patient_user_id)
  references auth.users(id)
  on delete set null;

alter table public.portal_messages
  add constraint portal_messages_sender_user_id_fkey
  foreign key (sender_user_id)
  references auth.users(id)
  on delete set null;

create index if not exists idx_credentialing_applications_assigned_user_id
  on public.credentialing_applications (assigned_user_id);

create index if not exists idx_roster_actions_assigned_user_id
  on public.roster_actions (assigned_user_id);

create index if not exists idx_portal_message_threads_created_by_patient_user_id
  on public.portal_message_threads (created_by_patient_user_id);

create index if not exists idx_portal_messages_sender_user_id
  on public.portal_messages (sender_user_id);

notify pgrst, 'reload schema';
