export type TelehealthAccessFacts = {
  isPracticeAdmin: boolean;
  isPlatformAdmin: boolean;
  isAssignedClinician: boolean;
  isPortalPatient: boolean;
  patientCheckInSubmitted: boolean;
};

export type TelehealthAccessDecision =
  | { allowed: true; participant: "staff" | "patient"; isOwner: boolean }
  | { allowed: false; reason: "check_in_required" | "forbidden" };

export function decideTelehealthAccess(facts: TelehealthAccessFacts): TelehealthAccessDecision {
  if (facts.isPlatformAdmin || facts.isPracticeAdmin || facts.isAssignedClinician) {
    return { allowed: true, participant: "staff", isOwner: true };
  }
  if (facts.isPortalPatient) {
    return facts.patientCheckInSubmitted
      ? { allowed: true, participant: "patient", isOwner: false }
      : { allowed: false, reason: "check_in_required" };
  }
  return { allowed: false, reason: "forbidden" };
}