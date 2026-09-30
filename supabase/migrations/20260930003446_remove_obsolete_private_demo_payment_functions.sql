drop function if exists private.post_demo_manual_payment(
  bigint,
  public.payment_source_enum,
  public.payment_method_enum,
  uuid,
  uuid,
  uuid,
  bigint,
  text,
  text,
  text
) restrict;

drop function if exists private.reverse_demo_payment(
  uuid,
  text
) restrict;
