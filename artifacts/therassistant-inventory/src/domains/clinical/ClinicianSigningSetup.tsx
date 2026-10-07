import { useState } from "react";
import { Link } from "wouter";
import { useTenant } from "../../auth/tenant-context";
import { linkCurrentUserToProvider } from "../treatment-plans/outcome-review-repository";
export function ClinicianSigningSetup({ providerId }: { providerId: string }) {
  const { roles } = useTenant();
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  if (!roles.includes("clinician")) return <div className="thera-alert">Your account needs the Clinician role to sign. <Link href="/administration/users">Open Users & Roles</Link> to configure the authorized signer.</div>;
  async function link() { setWorking(true); try { await linkCurrentUserToProvider(providerId); setMessage("Clinician account linked. You can now sign this provider’s coded visits."); } catch (e) { setMessage(e instanceof Error ? e.message : "Unable to link clinician account."); } finally { setWorking(false); } }
  return <div><button type="button" className="thera-action secondary" disabled={working || !providerId} onClick={() => void link()}>{working ? "Linking…" : "Link My Clinician Account"}</button><small> Use once if your clinician login is not linked to this rendering provider. The login and provider emails must match.</small>{message && <p role="status">{message}</p>}</div>;
}
