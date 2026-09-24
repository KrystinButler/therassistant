-- Payer-specific billing rules reuse the existing tenant-scoped, evidence-dated
-- payer_resources records rather than introducing a separate rule tracker.
alter table public.payer_resources
  add column if not exists billing_rule jsonb;

alter table public.payer_resources
  drop constraint if exists payer_resources_type_check;

alter table public.payer_resources
  add constraint payer_resources_type_check check (
    resource_type in (
      'provider_services', 'eligibility', 'claims', 'credentialing',
      'appeals', 'directory', 'portal', 'mailing_address', 'timely_filing',
      'corrected_claim', 'reimbursement', 'billing_rule', 'other'
    )
  );

alter table public.payer_resources
  add constraint payer_resources_billing_rule_shape_check check (
    (resource_type <> 'billing_rule' and billing_rule is null)
    or (
      resource_type = 'billing_rule'
      and jsonb_typeof(billing_rule) = 'object'
      and billing_rule ->> 'kind' in
        ('require_modifier', 'prohibit_modifier', 'allowed_pos', 'maximum_units')
      and (billing_rule ->> 'procedure_code') ~ '^[A-Za-z0-9]{4,7}$'
    )
  );

alter table public.payer_resources
  add constraint payer_resources_verified_billing_rule_evidence_check check (
    resource_type <> 'billing_rule'
    or verification_status <> 'verified'
    or (
      nullif(btrim(coalesce(source_url, '')), '') is not null
      and reviewed_at is not null
      and review_due_at is not null
      and effective_date is not null
    )
  );

create index if not exists payer_resources_billing_rule_lookup_idx
  on public.payer_resources (tenant_id, payer_id, payer_plan_id, effective_date, expiration_date)
  where resource_type = 'billing_rule';

comment on column public.payer_resources.billing_rule is
  'Structured payer/plan service-line rule. Only staff-verified, sourced, current rules may create billing holds; stale/unverified/conflicting rules remain advisory.';

-- payer_resources already has tenant-scoped SELECT/INSERT/UPDATE/DELETE RLS.
