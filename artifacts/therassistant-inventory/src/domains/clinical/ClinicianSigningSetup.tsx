import { Link } from "wouter";
import { useTenant } from "../../auth/tenant-context";

export function ClinicianSigningSetup({ providerId: _providerId }: { providerId: string }) {
  const { roles } = useTenant();

  if (!roles.includes("clinician")) {
    return (
      <div className="thera-alert">
        Your account needs the Clinician role to sign. <Link href="/administration/users">Open Users & Roles</Link> to configure the authorized signer.
      </div>
    );
  }

  // The sign action verifies/creates the current user's rendering-provider link
  // immediately before the signature RPC. No separate setup step is required.
  return null;
}
