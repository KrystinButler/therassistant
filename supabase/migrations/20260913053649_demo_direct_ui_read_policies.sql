do $$
declare
  tbl text;
  demo_tables text[] := array[
    'client_insurance_policies','client_contacts','client_diagnoses','client_checkins',
    'treatment_plans','treatment_plan_goals','clinical_note_signatures',
    'authorization_units','professional_claim_lines','claim_diagnoses','claim_status_history',
    'claim_balance_summaries','client_balance_summaries','claim_notes','account_notes',
    'payment_allocations','payment_reversals','adjustments','adjustment_allocations','adjustment_reversals',
    'appeals','workqueue_history','provider_identifiers','payer_contracts','fee_schedules','fee_schedule_lines',
    'claim_batches','claim_batch_items','claim_submissions','submission_responses',
    'era_files','era_claims','era_service_lines','era_adjustments','era_matches',
    'import_batches','import_rows','import_validation_errors','documents','notifications'
  ];
begin
  foreach tbl in array demo_tables loop
    execute format('drop policy if exists demo_anon_read on public.%I', tbl);
    execute format(
      'create policy demo_anon_read on public.%I for select to anon using (tenant_id in (select id from public.tenants where name = %L))',
      tbl,
      'Therassistant Demo'
    );
  end loop;
end $$;

drop policy if exists demo_anon_read on public.payer_plans;
create policy demo_anon_read on public.payer_plans for select to anon using (true);

drop policy if exists demo_anon_read on public.payer_aliases;
create policy demo_anon_read on public.payer_aliases for select to anon using (true);
