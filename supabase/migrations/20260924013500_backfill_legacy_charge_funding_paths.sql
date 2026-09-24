update public.charge_capture_items
set
  funding_source_type = case
    when charge_status = 'patient_responsibility'::public.charge_status_enum then 'private_pay'
    when payer_id is not null then 'insurance'
    else funding_source_type
  end,
  billing_path = case
    when charge_status = 'patient_responsibility'::public.charge_status_enum then 'private_pay'
    when payer_id is not null then 'insurance_claim'
    else billing_path
  end
where (funding_source_type is null or billing_path is null)
  and (
    charge_status = 'patient_responsibility'::public.charge_status_enum
    or payer_id is not null
  );
