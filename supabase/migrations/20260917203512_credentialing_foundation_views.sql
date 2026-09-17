-- Credentialing read models for UI/work queues. Views use security_invoker so base-table RLS applies.

CREATE OR REPLACE VIEW public.v_provider_enrollment_matrix
WITH (security_invoker = true)
AS
SELECT
  ppe.tenant_id,
  ppe.id AS enrollment_id,
  ppe.enrollment_status,
  ppe.effective_date,
  ppe.termination_date,
  ppe.payer_provider_id,
  ppe.notes,
  pr.id AS provider_id,
  concat_ws(' ', pr.first_name, pr.last_name) AS provider_name,
  pr.credentials,
  pr.individual_npi,
  py.id AS payer_id,
  py.name AS payer_name,
  ppe.updated_at,
  pp.id AS payer_plan_id,
  pp.name AS payer_plan_name,
  pe.id AS practice_entity_id,
  pe.legal_name AS practice_entity_name,
  pl.id AS practice_location_id,
  pl.name AS practice_location_name,
  pc.id AS payer_contract_id,
  pc.contract_name,
  pnp.participation_status,
  pnp.directory_status,
  pnp.last_verified_at AS participation_last_verified_at,
  ppe.revalidation_due_date
FROM public.provider_payer_enrollments ppe
JOIN public.providers pr ON pr.id = ppe.provider_id
JOIN public.payers py ON py.id = ppe.payer_id
LEFT JOIN public.payer_plans pp ON pp.id = ppe.payer_plan_id
LEFT JOIN public.practice_entities pe ON pe.id = ppe.practice_entity_id
LEFT JOIN public.practice_locations pl ON pl.id = ppe.practice_location_id
LEFT JOIN public.payer_contracts pc ON pc.id = ppe.payer_contract_id
LEFT JOIN public.provider_network_participation pnp ON pnp.enrollment_id = ppe.id;

REVOKE ALL ON public.v_provider_enrollment_matrix FROM anon;
GRANT SELECT ON public.v_provider_enrollment_matrix TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_credentialing_case_summary
WITH (security_invoker = true)
AS
SELECT
  ca.tenant_id,
  ca.id AS application_id,
  ca.status AS application_status,
  ca.application_type,
  ca.application_reference,
  ca.submitted_date,
  ca.payer_received_date,
  ca.decision_date,
  ca.effective_date AS application_effective_date,
  ca.last_contact_date,
  ca.next_followup_date,
  ca.priority,
  ca.assigned_user_id,
  ca.updated_at,
  ppe.id AS enrollment_id,
  ppe.enrollment_status,
  ppe.payer_provider_id,
  ppe.revalidation_due_date,
  pr.id AS provider_id,
  concat_ws(' ', pr.first_name, pr.last_name) AS provider_name,
  pr.credentials,
  pr.individual_npi,
  py.id AS payer_id,
  py.name AS payer_name,
  pp.id AS payer_plan_id,
  pp.name AS payer_plan_name,
  pe.id AS practice_entity_id,
  pe.legal_name AS practice_entity_name,
  pl.id AS practice_location_id,
  pl.name AS practice_location_name,
  pc.id AS payer_contract_id,
  pc.contract_name,
  pnp.id AS participation_id,
  pnp.participation_status,
  pnp.directory_status,
  pnp.last_verified_at AS participation_last_verified_at,
  (current_date - ca.created_at::date) AS application_age_days,
  COALESCE(req.missing_requirements, 0) AS missing_requirements
FROM public.credentialing_applications ca
JOIN public.provider_payer_enrollments ppe ON ppe.id = ca.enrollment_id
JOIN public.providers pr ON pr.id = ppe.provider_id
JOIN public.payers py ON py.id = ppe.payer_id
LEFT JOIN public.payer_plans pp ON pp.id = ppe.payer_plan_id
LEFT JOIN public.practice_entities pe ON pe.id = ppe.practice_entity_id
LEFT JOIN public.practice_locations pl ON pl.id = ppe.practice_location_id
LEFT JOIN public.payer_contracts pc ON pc.id = ppe.payer_contract_id
LEFT JOIN public.provider_network_participation pnp ON pnp.enrollment_id = ppe.id
LEFT JOIN LATERAL (
  SELECT count(*) FILTER (WHERE cr.status IN ('missing','requested')) AS missing_requirements
  FROM public.credentialing_requirements cr
  WHERE cr.application_id = ca.id
) req ON true;

REVOKE ALL ON public.v_credentialing_case_summary FROM anon;
GRANT SELECT ON public.v_credentialing_case_summary TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_credentialing_expirations
WITH (security_invoker = true)
AS
SELECT
  pc.tenant_id,
  pc.id AS source_id,
  'provider_credential'::text AS source_type,
  pc.provider_id,
  concat_ws(' ', p.first_name, p.last_name) AS provider_name,
  COALESCE(pc.credential_name, pc.credential_type) AS item_name,
  pc.expiration_date AS due_date,
  pc.status::text AS current_status,
  NULL::uuid AS payer_id,
  NULL::text AS payer_name
FROM public.provider_credentials pc
JOIN public.providers p ON p.id = pc.provider_id
WHERE pc.expiration_date IS NOT NULL

UNION ALL

SELECT
  p.tenant_id,
  p.id AS source_id,
  'caqh_attestation'::text AS source_type,
  p.id AS provider_id,
  concat_ws(' ', p.first_name, p.last_name) AS provider_name,
  'CAQH Attestation'::text AS item_name,
  p.caqh_next_attestation_date AS due_date,
  CASE WHEN p.caqh_next_attestation_date < current_date THEN 'overdue' ELSE 'upcoming' END AS current_status,
  NULL::uuid AS payer_id,
  NULL::text AS payer_name
FROM public.providers p
WHERE p.caqh_next_attestation_date IS NOT NULL

UNION ALL

SELECT
  ppe.tenant_id,
  ppe.id AS source_id,
  'payer_revalidation'::text AS source_type,
  ppe.provider_id,
  concat_ws(' ', p.first_name, p.last_name) AS provider_name,
  py.name || ' Revalidation' AS item_name,
  ppe.revalidation_due_date AS due_date,
  ppe.enrollment_status::text AS current_status,
  py.id AS payer_id,
  py.name AS payer_name
FROM public.provider_payer_enrollments ppe
JOIN public.providers p ON p.id = ppe.provider_id
JOIN public.payers py ON py.id = ppe.payer_id
WHERE ppe.revalidation_due_date IS NOT NULL

UNION ALL

SELECT
  pc.tenant_id,
  pc.id AS source_id,
  'payer_contract_recredentialing'::text AS source_type,
  NULL::uuid AS provider_id,
  NULL::text AS provider_name,
  py.name || ' - ' || pc.contract_name AS item_name,
  pc.recredentialing_due_date AS due_date,
  pc.status::text AS current_status,
  py.id AS payer_id,
  py.name AS payer_name
FROM public.payer_contracts pc
JOIN public.payers py ON py.id = pc.payer_id
WHERE pc.recredentialing_due_date IS NOT NULL;

REVOKE ALL ON public.v_credentialing_expirations FROM anon;
GRANT SELECT ON public.v_credentialing_expirations TO authenticated, service_role;
