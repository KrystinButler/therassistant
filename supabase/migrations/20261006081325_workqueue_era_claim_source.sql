-- New posting exceptions reference the exact retained remittance claim.
-- Existing claim/file tasks retain their historical scope.
alter type public.workqueue_source_object_type_enum add value if not exists 'era_claim';
