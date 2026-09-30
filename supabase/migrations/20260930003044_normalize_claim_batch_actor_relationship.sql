alter table public.claim_batches
  drop constraint claim_batches_edi_generated_by_fkey;

alter table public.claim_batches
  add constraint claim_batches_edi_generated_by_fkey
  foreign key (edi_generated_by)
  references auth.users(id)
  on delete set null;

notify pgrst, 'reload schema';
