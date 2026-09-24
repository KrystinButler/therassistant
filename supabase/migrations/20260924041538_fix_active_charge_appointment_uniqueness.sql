-- Keep legacy appointment charges unique without preventing multiple
-- legitimate encounter service lines on the same appointment.
DROP INDEX IF EXISTS public.uq_charge_capture_appointment;
CREATE UNIQUE INDEX IF NOT EXISTS uq_charge_capture_legacy_appointment
  ON public.charge_capture_items (appointment_id)
  WHERE appointment_id IS NOT NULL
    AND service_line_id IS NULL
    AND charge_status <> 'voided'::public.charge_status_enum;
-- uq_charge_capture_active_service_line independently prevents duplicate lines.
