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
