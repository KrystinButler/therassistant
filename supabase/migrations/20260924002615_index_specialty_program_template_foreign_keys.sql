create index specialty_program_template_items_template_tenant_idx
on public.specialty_program_template_items (template_id, tenant_id);

create index specialty_program_templates_created_by_idx
on public.specialty_program_templates (created_by)
where created_by is not null;
