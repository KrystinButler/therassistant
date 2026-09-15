begin;

create index if not exists mailroom_items_client_fk_idx
  on public.mailroom_items (client_id)
  where client_id is not null;
create index if not exists mailroom_items_provider_fk_idx
  on public.mailroom_items (provider_id)
  where provider_id is not null;
create index if not exists mailroom_items_authorization_fk_idx
  on public.mailroom_items (authorization_id)
  where authorization_id is not null;
create index if not exists mailroom_items_appeal_fk_idx
  on public.mailroom_items (appeal_id)
  where appeal_id is not null;
create index if not exists mailroom_items_document_fk_idx
  on public.mailroom_items (document_id)
  where document_id is not null;
create index if not exists mailroom_items_assigned_user_fk_idx
  on public.mailroom_items (assigned_user_id)
  where assigned_user_id is not null;
create index if not exists mailroom_items_claim_fk_idx
  on public.mailroom_items (claim_id)
  where claim_id is not null;
create index if not exists mailroom_items_payer_fk_idx
  on public.mailroom_items (payer_id)
  where payer_id is not null;

commit;
