-- Only a patient with active portal access may author their journal.
-- Historical staff-transcribed patient reports remain intact for provenance.
-- The patient portal's private SECURITY DEFINER RPC validates auth.uid()
-- against client_portal_access and retains patient-authoring privileges.
drop policy if exists "patient_journal_entries staff shared insert" on public.patient_journal_entries;
revoke insert on public.patient_journal_entries from authenticated;
