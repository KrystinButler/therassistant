import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/auth-context";
import { useTenant } from "../../auth/tenant-context";
import { tenantRpc } from "../../lib/tenant-data-client";
import { WorkDrawer } from "../../components/work-drawer";
import { UserRolesPage } from "../../pages/users-roles";
import { linkCurrentUserToProvider } from "../treatment-plans/outcome-review-repository";

type Readiness = { can_sign: boolean; reason: string; email_match?: boolean };
const reasons: Record<string, string> = {
  clinician_role_required: "Your login needs the Clinician role and a rendering provider assignment before you can sign.",
  provider_not_linked: "Link your clinician login to this rendering provider before charting.",
  email_mismatch: "Your clinician login is not assigned to this rendering provider. A practice administrator must confirm the assignment in Users & Roles.",
  provider_required: "Select a rendering provider before signing.",
  provider_inactive: "This rendering provider is inactive. Correct the provider setup before signing.",
};
export function ClinicianSigningSetup({ providerId, onReadinessChange }: { providerId: string; onReadinessChange?: (ready: boolean, providerId: string) => void }) {
  const { roles, tenantId } = useTenant();
  const { user } = useAuth();
  const [state, setState] = useState<Readiness | null>(null);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const [open, setOpen] = useState(false);
  const generation = useRef(0);
  const isAdmin = roles.some(role => ["practice_admin", "platform_admin", "billing_company_admin"].includes(role));
  const check = useCallback(async () => {
    const current = ++generation.current;
    setState(null); setMessage(""); onReadinessChange?.(false, providerId);
    try {
      const result = providerId ? await tenantRpc<Readiness>("clinician_signing_readiness", { p_provider_id: providerId }) : {can_sign:false,reason:"provider_required"};
      if (current !== generation.current) return;
      if (typeof result?.can_sign !== "boolean") throw new Error("Unable to check signing setup. Retry before signing.");
      setState(result); onReadinessChange?.(result.can_sign, providerId);
    } catch (error) {
      if (current === generation.current) setMessage(error instanceof Error ? error.message : "Unable to check signing setup.");
    }
  }, [providerId, tenantId, user?.id, onReadinessChange]);
  useEffect(() => { void check(); return () => { generation.current++; }; }, [check]);
  async function link() {
    setWorking(true);
    try { await linkCurrentUserToProvider(providerId); await check(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to link clinician account."); }
    finally { setWorking(false); }
  }
  return <section className="thera-alert" aria-label="Clinician signing readiness" style={{marginBottom:16}}>
    <strong>{state?.can_sign ? "Ready to sign as this rendering provider" : "Signing setup"}</strong>
    {!state?.can_sign && <p>{message || (state ? reasons[state.reason] ?? "Signing is unavailable. Review your clinician setup." : "Checking clinician role and provider assignment…")}</p>}
    {state && !state.can_sign && <small>Your draft can still be saved. Complete signing setup before starting clinical documentation.</small>}
    {state?.reason === "provider_not_linked" && <button type="button" className="thera-action secondary" disabled={working} onClick={() => void link()}>{working ? "Linking…" : "Link My Clinician Account"}</button>}
    {!state?.can_sign && isAdmin && <button type="button" className="thera-action secondary" onClick={() => setOpen(true)}>Configure Clinician Assignment</button>}
    {!state?.can_sign && <button type="button" className="thera-action secondary" disabled={working} onClick={() => void check()}>Recheck Signing Setup</button>}
    <WorkDrawer open={open} onOpenChange={value => { setOpen(value); if (!value) void check(); }} title="Clinician account setup" subtitle="Assign the actual signing clinician. Your encounter draft stays open.">{open && <UserRolesPage />}</WorkDrawer>
  </section>;
}
