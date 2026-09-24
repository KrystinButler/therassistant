import { useEffect, useState } from "react";

import { shortDate } from "../lib/format";
import { tenantSelect, type Row } from "../lib/tenant-data-client";
import { StatusBadge } from "./status-badge";

export type PayerIntelligenceContext =
  | "credentialing"
  | "claim"
  | "follow_up"
  | "appeal"
  | "eligibility";

type PayerResource = Row & {
  id: string;
  payer_plan_id?: string | null;
  resource_type: string;
  label: string;
  value?: string | null;
  url?: string | null;
  source_url?: string | null;
  notes?: string | null;
  effective_date?: string | null;
  expiration_date?: string | null;
  reviewed_at?: string | null;
  review_due_at?: string | null;
  verification_status?: string | null;
  sort_order?: number | null;
  created_at?: string | null;
};

type Props = {
  payerId: string;
  payerPlanId?: string | null;
  context: PayerIntelligenceContext;
  claimId?: string | null;
  providerId?: string | null;
  applicationId?: string | null;
  title?: string;
  defaultOpen?: boolean;
};

const resourceTypesByContext: Record<PayerIntelligenceContext, string[]> = {
  credentialing: ["credentialing", "portal", "provider_services", "directory"],
  claim: ["claims", "billing_rule", "corrected_claim", "timely_filing", "mailing_address", "portal"],
  follow_up: ["provider_services", "claims", "portal", "timely_filing", "corrected_claim"],
  appeal: ["appeals", "mailing_address", "portal", "timely_filing", "provider_services"],
  eligibility: ["eligibility", "portal", "provider_services"],
};

const resourceLabels: Record<string, string> = {
  provider_services: "Provider Services",
  eligibility: "Eligibility",
  claims: "Claims / EDI",
  credentialing: "Credentialing",
  appeals: "Appeals",
  directory: "Directory",
  portal: "Portal",
  mailing_address: "Mailing Address",
  timely_filing: "Timely Filing",
  corrected_claim: "Corrected Claim",
  reimbursement: "Reimbursement",
  billing_rule: "Billing Rule",
  other: "Other",
};

function resourceLabel(value: string) {
  return resourceLabels[value] || value.replaceAll("_", " ");
}

function phoneHref(value?: string | null) {
  if (!value) return null;
  const digits = value.replace(/[^0-9+]/g, "");
  const digitCount = digits.replace(/\D/g, "").length;
  return digitCount >= 7 ? `tel:${digits}` : null;
}

function dateSignal(reviewDueAt?: string | null) {
  if (!reviewDueAt) return null;
  const end = new Date(`${reviewDueAt.slice(0, 10)}T23:59:59`);
  if (Number.isNaN(end.getTime())) return null;
  const days = Math.ceil((end.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return "possibly_outdated";
  if (days <= 30) return "review_soon";
  return null;
}

export function PayerIntelligencePanel({
  payerId,
  payerPlanId,
  context,
  claimId,
  providerId,
  applicationId,
  title = "Payer Instructions",
  defaultOpen = true,
}: Props) {
  const [resources, setResources] = useState<PayerResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    void tenantSelect<PayerResource>("payer_resources", {
      payer_id: `eq.${payerId}`,
      order: "sort_order.asc,resource_type.asc,created_at.asc",
    })
      .then((rows) => {
        if (!active) return;
        const allowed = new Set(resourceTypesByContext[context]);
        setResources(rows.filter((row) => {
          if (!allowed.has(String(row.resource_type || ""))) return false;
          const resourcePlanId = row.payer_plan_id ? String(row.payer_plan_id) : null;
          if (!payerPlanId) return resourcePlanId === null;
          return resourcePlanId === null || resourcePlanId === payerPlanId;
        }));
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Unable to load payer instructions.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [context, payerId, payerPlanId]);

  async function copyValue(resource: PayerResource) {
    const value = String(resource.value || resource.url || "").trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(resource.id);
      window.setTimeout(() => setCopiedId((current) => (current === resource.id ? null : current)), 1500);
    } catch {
      setError("Copy failed. Select the value manually.");
    }
  }

  return (
    <section
      className="thera-card"
      data-payer-id={payerId}
      data-payer-plan-id={payerPlanId || undefined}
      data-claim-id={claimId || undefined}
      data-provider-id={providerId || undefined}
      data-application-id={applicationId || undefined}
    >
      <div className="thera-card-header">
        <div>
          <div className="thera-eyebrow">CONTEXTUAL PAYER INTELLIGENCE</div>
          <h2>{title}</h2>
          <p>
            {context === "credentialing"
              ? "Credentialing contacts, portals, directory resources and payer instructions for this case."
              : context === "follow_up"
                ? "Claim-status contacts, portals, filing guidance and corrected-claim rules for this payer."
                : context === "appeal"
                  ? "Appeal channels, addresses, filing guidance and payer contacts."
                  : context === "eligibility"
                    ? "Eligibility portals and payer contact resources."
                    : "Claim submission, corrected-claim and filing resources for this payer."}
          </p>
        </div>
        <button type="button" className="thera-action secondary" onClick={() => setOpen((value) => !value)}>
          {open ? "Collapse" : "Payer Instructions"}
        </button>
      </div>

      {open ? (
        <>
          {loading ? <div className="thera-state">Loading payer instructions...</div> : null}
          {error ? <div className="thera-state error">{error}</div> : null}
          {!loading && !error && resources.length === 0 ? (
            <div className="thera-state">
              No matching payer instructions have been captured yet. Add them once in Payer 360 and they will appear here automatically.
            </div>
          ) : null}
          {!loading && resources.length > 0 ? (
            <div className="thera-stack">
              {resources.map((resource) => {
                const phone = resource.resource_type === "provider_services" ? phoneHref(resource.value) : null;
                const signal = dateSignal(resource.review_due_at);
                return (
                  <div className="thera-story" key={resource.id}>
                    <div className="thera-row-between">
                      <div>
                        <div className="thera-filter-row">
                          <StatusBadge value={resourceLabel(resource.resource_type)} />
                          <StatusBadge value={resource.payer_plan_id ? "plan_specific" : "payer_wide"} />
                          <StatusBadge value={resource.verification_status || "unverified"} />
                          {signal ? <StatusBadge value={signal} /> : null}
                        </div>
                        <strong>{resource.label || "Payer resource"}</strong>
                      </div>
                      <div className="thera-filter-row">
                        {resource.url ? (
                          <a
                            className="thera-action secondary"
                            href={resource.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open
                          </a>
                        ) : null}
                        {resource.source_url && resource.source_url !== resource.url ? (
                          <a className="thera-action secondary" href={resource.source_url} target="_blank" rel="noreferrer">
                            Source
                          </a>
                        ) : null}
                        {phone ? (
                          <a className="thera-action secondary" href={phone}>
                            Call
                          </a>
                        ) : null}
                        {resource.value || resource.url ? (
                          <button
                            type="button"
                            className="thera-action secondary"
                            onClick={() => void copyValue(resource)}
                          >
                            {copiedId === resource.id ? "Copied" : "Copy"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {resource.value ? <div>{resource.value}</div> : null}
                    {resource.notes ? <div>{resource.notes}</div> : null}
                    {resource.resource_type === "billing_rule" ? <div className="thera-table-subtext">Only currently verified, source-linked payer billing rules can hold billing. Other rules require manual review.</div> : null}
                    {(resource.effective_date || resource.expiration_date) ? (
                      <div className="thera-table-subtext">
                        Policy/effective period: {shortDate(resource.effective_date)} — {shortDate(resource.expiration_date)}
                      </div>
                    ) : null}
                    {(resource.reviewed_at || resource.review_due_at) ? (
                      <div className="thera-table-subtext">
                        Source reviewed {shortDate(resource.reviewed_at)} · Next review {shortDate(resource.review_due_at)}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
