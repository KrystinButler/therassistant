create policy "encounters tenant select"
on public.encounters
for select
to authenticated
using (private.has_tenant_read_access(tenant_id));

create policy "encounters tenant insert"
on public.encounters
for insert
to authenticated
with check (private.has_tenant_write_access(tenant_id));

create policy "encounters tenant update"
on public.encounters
for update
to authenticated
using (private.has_tenant_write_access(tenant_id))
with check (private.has_tenant_write_access(tenant_id));

create policy "encounter_diagnoses tenant select"
on public.encounter_diagnoses
for select
to authenticated
using (private.has_tenant_read_access(tenant_id));

create policy "encounter_diagnoses tenant insert"
on public.encounter_diagnoses
for insert
to authenticated
with check (private.has_tenant_write_access(tenant_id));

create policy "encounter_diagnoses tenant update"
on public.encounter_diagnoses
for update
to authenticated
using (private.has_tenant_write_access(tenant_id))
with check (private.has_tenant_write_access(tenant_id));

create policy "encounter_service_lines tenant select"
on public.encounter_service_lines
for select
to authenticated
using (private.has_tenant_read_access(tenant_id));

create policy "encounter_service_lines tenant insert"
on public.encounter_service_lines
for insert
to authenticated
with check (private.has_tenant_write_access(tenant_id));

create policy "encounter_service_lines tenant update"
on public.encounter_service_lines
for update
to authenticated
using (private.has_tenant_write_access(tenant_id))
with check (private.has_tenant_write_access(tenant_id));

create policy "encounter_readiness_checks tenant select"
on public.encounter_readiness_checks
for select
to authenticated
using (private.has_tenant_read_access(tenant_id));

create policy "encounter_readiness_checks tenant insert"
on public.encounter_readiness_checks
for insert
to authenticated
with check (private.has_tenant_write_access(tenant_id));

create policy "encounter_readiness_checks tenant update"
on public.encounter_readiness_checks
for update
to authenticated
using (private.has_tenant_write_access(tenant_id))
with check (private.has_tenant_write_access(tenant_id));
