
alter view public.reference_library_status set (security_invoker = true);

revoke all privileges on table
  public.reference_code_systems,
  public.icd10_codes,
  public.cpt_codes,
  public.hcpcs_codes,
  public.code_modifiers,
  public.place_of_service_codes
from anon;

revoke insert, update, delete, truncate, references, trigger on table
  public.reference_code_systems,
  public.icd10_codes,
  public.cpt_codes,
  public.hcpcs_codes,
  public.code_modifiers,
  public.place_of_service_codes
from authenticated;

grant select on table
  public.reference_code_systems,
  public.icd10_codes,
  public.cpt_codes,
  public.hcpcs_codes,
  public.code_modifiers,
  public.place_of_service_codes
to authenticated;

revoke all privileges on table public.reference_library_status from anon;
grant select on table public.reference_library_status to authenticated;
