alter table public.client_checkins
  add column if not exists on_my_way_at timestamptz;

create index if not exists idx_client_checkins_client_created
  on public.client_checkins(client_id, created_at desc);
