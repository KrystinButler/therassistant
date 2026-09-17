create table if not exists public.mailroom_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  payer_id uuid references public.payers(id),
  claim_id uuid references public.professional_claims(id),
  subject text not null,
  correspondence_type text not null default 'payer_correspondence',
  received_date date not null default current_date,
  status text not null default 'new',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.mailroom_items enable row level security;
grant select, insert, update on public.mailroom_items to anon;

drop policy if exists "demo anon mailroom" on public.mailroom_items;
create policy "demo anon mailroom" on public.mailroom_items
for all to anon
using (exists (
  select 1 from public.tenants t
  where t.id = mailroom_items.tenant_id
    and coalesce((t.settings->>'demo')::boolean, false) is true
))
with check (exists (
  select 1 from public.tenants t
  where t.id = mailroom_items.tenant_id
    and coalesce((t.settings->>'demo')::boolean, false) is true
));

insert into public.mailroom_items (tenant_id, payer_id, claim_id, subject, correspondence_type, received_date, status, notes)
select t.id, c.payer_id, c.id, 'Claim status correspondence', 'claim_correspondence', current_date - 2, 'new', 'Synthetic payer correspondence for the Therassistant demo.'
from public.tenants t
join lateral (
  select pc.* from public.professional_claims pc where pc.tenant_id=t.id order by pc.created_at limit 1
) c on true
where t.name='Therassistant Demo'
  and not exists (select 1 from public.mailroom_items m where m.tenant_id=t.id)
limit 1;
