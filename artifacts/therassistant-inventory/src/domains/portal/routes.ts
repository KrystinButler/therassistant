export const PORTAL_HOME = "/patient-portal";
export const PORTAL_LOGIN = "/patient-portal/login";
export const PORTAL_ACTIVATE = "/patient-portal/activate";
export const PORTAL_RECOVER = "/patient-portal/recover";
export const PORTAL_JOURNAL = "/patient-portal/journal";

export function portalCheckInPath(appointmentId: string) {
  return `/patient-portal/check-in/${encodeURIComponent(appointmentId)}`;
}

export function isPatientPortalPath(pathname: string) {
  return pathname === PORTAL_HOME || pathname.startsWith("/patient-portal/");
}

/** Resolve only the signed-in email's patient invitation; active staff accounts
 * always retain their distinct staff landing page. */
export function rootPatientPortalDestination(input: {
  status: unknown;
  invitedEmail: unknown;
  authenticatedEmail: unknown;
  hasActiveStaffMembership: boolean;
}): string | null {
  const invited = String(input.invitedEmail ?? "").trim().toLowerCase();
  const current = String(input.authenticatedEmail ?? "").trim().toLowerCase();
  if (input.hasActiveStaffMembership || !invited || !current || invited !== current) return null;
  if (input.status === "invited") return PORTAL_ACTIVATE;
  if (input.status === "active") return PORTAL_HOME;
  return null;
}
