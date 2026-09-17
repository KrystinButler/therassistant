update public.tenants
set status = 'inactive'::public.tenant_status_enum,
    settings = jsonb_set(
      jsonb_set(coalesce(settings, '{}'::jsonb), '{demo}', 'false'::jsonb, true),
      '{synthetic}', 'false'::jsonb, true
    ),
    updated_at = now()
where name = 'Therassistant Demo'
  and (
    status <> 'inactive'::public.tenant_status_enum
    or coalesce((settings ->> 'demo')::boolean, false) is true
    or coalesce((settings ->> 'synthetic')::boolean, false) is true
  );
