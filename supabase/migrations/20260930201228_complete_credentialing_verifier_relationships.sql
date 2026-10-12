-- Link credentialing verification actors to the canonical authentication identity.
-- Preserve credentialing records when an authentication user is deleted.
alter table public.provider_credentials
  add constraint provider_credentials_verified_by_fkey
  foreign key (verified_by) references auth.users(id) on delete set null;

alter table public.credentialing_requirements
  add constraint credentialing_requirements_verified_by_fkey
  foreign key (verified_by) references auth.users(id) on delete set null;

alter table public.participation_verifications
  add constraint participation_verifications_verified_by_fkey
  foreign key (verified_by) references auth.users(id) on delete set null;

create index idx_provider_credentials_verified_by
  on public.provider_credentials (verified_by);
create index idx_credentialing_requirements_verified_by
  on public.credentialing_requirements (verified_by);
create index idx_participation_verifications_verified_by
  on public.participation_verifications (verified_by);

notify pgrst, 'reload schema';
