#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

case "$DATABASE_URL" in
  *127.0.0.1*|*localhost*) ;;
  *)
    echo "Restore rehearsal is restricted to the isolated local Supabase stack."
    exit 1
    ;;
esac

DB_CONTAINER="$(docker ps --filter 'name=supabase_db_' --format '{{.ID}}' | head -n 1)"
if [ -z "$DB_CONTAINER" ]; then
  echo "Could not locate the isolated Supabase Postgres container."
  exit 1
fi

RESTORE_DB="therassistant_restore_drill"
DUMP_PATH="/tmp/therassistant-restore-drill.dump"

cleanup() {
  docker exec "$DB_CONTAINER" dropdb -U postgres --if-exists "$RESTORE_DB" >/dev/null 2>&1 || true
  docker exec "$DB_CONTAINER" rm -f "$DUMP_PATH" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup

echo "Creating local synthetic recovery artifact..."
docker exec "$DB_CONTAINER" pg_dump \
  -U postgres \
  -d postgres \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="$DUMP_PATH"

RESTORE_ROLE="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -Atqc "select rolname from pg_roles where rolsuper order by case when rolname='supabase_admin' then 0 else 1 end, rolname limit 1;")"
if [ -z "$RESTORE_ROLE" ]; then
  echo "The isolated Supabase stack does not expose a superuser role for full-database restore."
  exit 1
fi

echo "Restoring into disposable local database with $RESTORE_ROLE..."
docker exec "$DB_CONTAINER" createdb -U postgres -T template0 "$RESTORE_DB"
docker exec "$DB_CONTAINER" pg_restore \
  -U "$RESTORE_ROLE" \
  -d "$RESTORE_DB" \
  --no-owner \
  --no-acl \
  --exit-on-error \
  "$DUMP_PATH"

query() {
  local database="$1"
  local sql="$2"
  docker exec "$DB_CONTAINER" psql -U postgres -d "$database" -Atqc "$sql"
}

tables=(
  "auth.users"
  "public.tenants"
  "public.tenant_users"
  "public.tenant_user_roles"
  "public.clients"
  "public.providers"
  "public.appointments"
  "public.client_portal_access"
  "public.encounters"
  "public.clinical_notes"
  "public.charge_capture_items"
  "public.professional_claims"
  "public.payments"
  "public.payment_allocations"
  "public.workqueue_items"
  "supabase_migrations.schema_migrations"
)

for table in "${tables[@]}"; do
  source_count="$(query postgres "select count(*) from $table;")"
  restored_count="$(query "$RESTORE_DB" "select count(*) from $table;")"
  if [ "$source_count" != "$restored_count" ]; then
    echo "Restore mismatch for $table: source=$source_count restored=$restored_count"
    exit 1
  fi
done

source_rls="$(query postgres "select relrowsecurity::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='clients';")"
restored_rls="$(query "$RESTORE_DB" "select relrowsecurity::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='clients';")"
if [ "$source_rls" != "true" ] || [ "$restored_rls" != "true" ]; then
  echo "Client RLS was not preserved by the restore rehearsal."
  exit 1
fi

source_policies="$(query postgres "select count(*) from pg_policies where schemaname='public' and tablename='clients';")"
restored_policies="$(query "$RESTORE_DB" "select count(*) from pg_policies where schemaname='public' and tablename='clients';")"
if [ "$source_policies" != "$restored_policies" ] || [ "$restored_policies" -lt 3 ]; then
  echo "Client RLS policy count was not preserved."
  exit 1
fi

source_helpers="$(query postgres "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('has_tenant_read_access','has_tenant_write_access');")"
restored_helpers="$(query "$RESTORE_DB" "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('has_tenant_read_access','has_tenant_write_access');")"
if [ "$source_helpers" != "$restored_helpers" ] || [ "$restored_helpers" -lt 2 ]; then
  echo "Tenant access helper functions were not preserved."
  exit 1
fi

patient_count="$(query "$RESTORE_DB" "select count(*) from public.clients where id in ('40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002');")"
if [ "$patient_count" != "2" ]; then
  echo "Expected synthetic patient fixtures were not restored."
  exit 1
fi

echo "Isolated restore rehearsal verified: data counts, migration history, Auth rows, RLS policies, and tenant access helpers match the source database."
