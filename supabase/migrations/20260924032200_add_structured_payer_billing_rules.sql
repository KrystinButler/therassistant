-- Reuse tenant-scoped payer resources for auditable, plan-scoped billing rules.
alter table public.payer_resources
  add column if not exists rule_config jsonb;

alter table public.payer_resources
  drop constraint if exists payer_resources_type_check;

alter table public.payer_resources
  add constraint payer_resources_type_check check (
    resource_type in (
      'provider_services','eligibility','claims','credentialing','appeals',
      'directory','portal','mailing_address','timely_filing',
      'corrected_claim','reimbursement','billing_rule','other'
    )
  );

alter table public.payer_resources
  add constraint payer_resources_billing_rule_shape_check check (
    resource_type <> 'billing_rule'
    or (
      rule_config is not null
      and jsonb_typeof(rule_config) = 'object'
      and nullif(btrim(rule_config ->> 'procedure_code'), '') is not null
    )
  );

comment on column public.payer_resources.rule_config is
  'Optional billing-rule configuration. Evaluated for the selected payer/plan only when verified and supported by current source/review evidence.';

create index if not exists payer_resources_billing_rule_lookup_idx
  on public.payer_resources (tenant_id,payer_id,payer_plan_id,resource_type)
  where resource_type = 'billing_rule';