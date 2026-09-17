alter table public.clinical_note_signatures
  add column if not exists provider_id uuid references public.providers(id);

alter table public.clinical_note_signatures
  alter column signer_id drop not null;

alter table public.clinical_note_signatures
  drop constraint if exists clinical_note_signatures_identity_check;

alter table public.clinical_note_signatures
  add constraint clinical_note_signatures_identity_check
  check (signer_id is not null or provider_id is not null);

create index if not exists clinical_note_signatures_provider_id_idx
  on public.clinical_note_signatures(provider_id);
