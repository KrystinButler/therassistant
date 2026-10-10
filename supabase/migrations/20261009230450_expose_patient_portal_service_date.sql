create or replace function public.get_my_patient_portal_data()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with payload as (
    select private.get_my_patient_portal_data_impl() as body
  )
  select jsonb_set(
    body,
    '{appointments}',
    coalesce(
      (
        select jsonb_agg(
          appointment || jsonb_build_object(
            'service_date',
            to_char(
              ((appointment ->> 'starts_at')::timestamptz at time zone 'America/Denver')::date,
              'YYYY-MM-DD'
            )
          )
        )
        from jsonb_array_elements(coalesce(body -> 'appointments', '[]'::jsonb)) as appointment
      ),
      '[]'::jsonb
    ),
    true
  )
  from payload;
$$;

revoke all on function public.get_my_patient_portal_data() from public, anon;
grant execute on function public.get_my_patient_portal_data() to authenticated;
