import { Link } from "wouter";
import { money } from "../../lib/format";
import type { PortalAccessState } from "./workflow";

type PortalAccessGateProps = {
  clientId: string;
  access: PortalAccessState;
};

export function PortalAccessGate({ clientId, access }: PortalAccessGateProps) {
  if (!access.restricted) return null;

  return (
    <section className="portal-access-gate" aria-labelledby="portal-access-gate-title">
      <div>
        <h2 id="portal-access-gate-title">Account Access Restricted</h2>
        <p>
          Your current patient balance is {money(access.openBalanceCents)}. The practice balance threshold is {access.thresholdCents === null ? "not configured" : money(access.thresholdCents)}.
        </p>
      </div>
      <p>
        To continue using restricted portal features, review the available payment-plan and exception options. Submitting a request does not restore access until the practice activates the plan or approves the exception.
      </p>
      <div>
        <Link className="portal-button" href={`/patient-portal/${clientId}/access`}>
          Review Access Options
        </Link>
      </div>
    </section>
  );
}
