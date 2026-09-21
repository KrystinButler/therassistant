do $$
declare
  v_account_id uuid;
begin
  select id into v_account_id
  from public.crm_accounts
  where account_number = 'CRM-000001'
     or (
       lower(coalesce(email::text,'')) = 'admin1@ispmind.com'
       and original_balance_cents = 1108125
     )
  order by created_at
  limit 1;

  if v_account_id is null then
    insert into public.crm_accounts (
      account_number,
      customer_name,
      phone,
      email,
      address_line1,
      city,
      state,
      postal_code,
      original_balance_cents,
      status,
      created_by,
      updated_by
    )
    values (
      'CRM-000001',
      'Inner Space Psychiatry PLLC / Brandon D. Burelle, PMHNP-BC',
      '720-257-9701',
      'admin1@ispmind.com',
      '1600 N. Pennsylvania Street, Suite 101',
      'Denver',
      'CO',
      '80203',
      1108125,
      'active',
      'admin@therassistant.com',
      'admin@therassistant.com'
    )
    returning id into v_account_id;
  end if;

  if not exists (
    select 1 from public.crm_notes
    where account_id = v_account_id
      and note like 'Original collection principal: $11,081.25.%'
  ) then
    insert into public.crm_notes (account_id,note,created_by)
    values (
      v_account_id,
      'Original collection principal: $11,081.25. Supporting unpaid invoices: BDB-0003, BDB-0004, BDB-0005, BDB-0006. Prior collection materials dated August 8, 2026 also calculated $3,412.91 accrued interest and a $14,494.16 payoff; that interest is not included in the CRM original balance.',
      'admin@therassistant.com'
    );
  end if;

  if not exists (
    select 1 from public.crm_activity
    where account_id = v_account_id
      and activity_type = 'account_seeded'
  ) then
    insert into public.crm_activity (
      account_id,activity_type,summary,related_table,related_id,metadata,actor_email
    )
    values (
      v_account_id,
      'account_seeded',
      'Initial collection account created from existing Therassistant collection records.',
      'crm_accounts',
      v_account_id,
      jsonb_build_object(
        'originalPrincipalCents',1108125,
        'unpaidInvoices',jsonb_build_array('BDB-0003','BDB-0004','BDB-0005','BDB-0006')
      ),
      'admin@therassistant.com'
    );
  end if;

  perform setval(
    'public.crm_account_number_seq',
    greatest(
      1,
      coalesce((
        select max((substring(account_number from 5))::bigint)
        from public.crm_accounts
        where account_number ~ '^CRM-[0-9]+$'
      ),1)
    ),
    true
  );
end $$;
