DO $$
declare
  r record;
  index_name text;
begin
  for r in
    select
      ns.nspname as schema_name,
      rel.relname as table_name,
      con.conname as constraint_name,
      string_agg(quote_ident(att.attname), ', ' order by cols.ordinality) as column_list
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    join unnest(con.conkey) with ordinality as cols(attnum, ordinality) on true
    join pg_attribute att on att.attrelid = rel.oid and att.attnum = cols.attnum
    where con.contype = 'f'
      and ns.nspname = 'public'
      and not exists (
        select 1
        from pg_index idx
        where idx.indrelid = con.conrelid
          and idx.indkey::int2[] @> con.conkey
      )
    group by ns.nspname, rel.relname, con.conname
  loop
    index_name := 'idx_fk_' || substr(md5(r.schema_name || '.' || r.table_name || '.' || r.constraint_name), 1, 16);
    execute format('create index if not exists %I on %I.%I (%s)', index_name, r.schema_name, r.table_name, r.column_list);
  end loop;
end $$;

drop policy if exists "notifications tenant select" on public.notifications;
drop policy if exists "notifications tenant insert" on public.notifications;
drop policy if exists "notifications tenant update" on public.notifications;
