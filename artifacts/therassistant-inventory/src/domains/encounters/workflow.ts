import { blocked, failure, success, type WorkflowResult } from "../shared/workflow-result";

export type AppointmentForEncounter = {
  id: string;
  tenant_id?: string;
  client_id: string;
  provider_id?: string | null;
  appointment_status: string;
  location_type?: string | null;
  service_type?: string | null;
};

export type EncounterRecord = Record<string, any> & { id: string };

export type EncounterRepository = {
  getAppointment(id: string): Promise<AppointmentForEncounter | null>;
  getExistingEncounterByAppointment(id: string): Promise<EncounterRecord | null>;
  getPreSessionContext(id: string): Promise<{
    readiness: { ready: boolean; checks: Array<{ blocking?: boolean; message?: string }> };
    policyId?: string | null;
    payerId?: string | null;
  }>;
  createEncounter(values: Record<string, unknown>): Promise<EncounterRecord>;
  updateAppointment(id: string, values: Record<string, unknown>): Promise<Record<string, unknown>>;
};

const notStartable = new Set(["cancelled", "no_show", "rescheduled", "late_cancel", "completed"]);

export async function startEncounterWorkflow(
  repo: EncounterRepository,
  appointmentId: string,
): Promise<WorkflowResult<EncounterRecord>> {
  const existing = await repo.getExistingEncounterByAppointment(appointmentId);
  if (existing) return success(existing);

  const appointment = await repo.getAppointment(appointmentId);
  if (!appointment) {
    return failure("appointment_not_found", "Appointment not found.");
  }

  if (notStartable.has(appointment.appointment_status)) {
    return blocked(
      "appointment_not_startable",
      `A ${appointment.appointment_status.replaceAll("_", " ")} appointment cannot start an encounter.`,
    );
  }

  const preSession = await repo.getPreSessionContext(appointmentId);
  if (!preSession.readiness.ready) {
    return blocked(
      "pre_session_blocked",
      "Resolve pre-session readiness issues before starting the encounter.",
      preSession.readiness.checks
        .filter((check) => check.blocking)
        .map((check) => check.message || "Readiness requirement is not satisfied."),
    );
  }

  try {
    const encounter = await repo.createEncounter({
      appointment_id: appointment.id,
      client_id: appointment.client_id,
      provider_id: appointment.provider_id || null,
      insurance_policy_id: preSession.policyId || null,
      payer_id: preSession.payerId || null,
      encounter_status: "in_progress",
      billing_status: "not_ready",
      started_at: new Date().toISOString(),
      location_type: appointment.location_type || null,
      service_type: appointment.service_type || null,
    });

    await repo.updateAppointment(appointment.id, {
      appointment_status: "in_session",
    });

    return success(encounter);
  } catch (error) {
    return failure(
      "encounter_start_failed",
      error instanceof Error ? error.message : "Unable to start encounter.",
    );
  }
}
