create index if not exists adjustments_denial_id_idx
  on public.adjustments (denial_id)
  where denial_id is not null;
