alter table public.credentialing_application_events
  add constraint credentialing_application_events_created_by_fkey
  foreign key (created_by)
  references auth.users(id)
  on delete set null;

alter table public.credentialing_document_links
  add constraint credentialing_document_links_created_by_fkey
  foreign key (created_by)
  references auth.users(id)
  on delete set null;

alter table public.credentialing_followups
  add constraint credentialing_followups_created_by_fkey
  foreign key (created_by)
  references auth.users(id)
  on delete set null;

create index if not exists idx_credentialing_application_events_created_by
  on public.credentialing_application_events (created_by);

create index if not exists idx_credentialing_document_links_created_by
  on public.credentialing_document_links (created_by);

create index if not exists idx_credentialing_followups_created_by
  on public.credentialing_followups (created_by);

notify pgrst, 'reload schema';
