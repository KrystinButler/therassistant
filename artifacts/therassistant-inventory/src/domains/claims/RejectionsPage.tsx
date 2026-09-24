import { useEffect, useMemo, useState } from "react";

import { StatusBadge } from "../../components/status-badge";
import { money, shortDate } from "../../lib/format";
import {
  getOperationalHome,
  getRejectionCategories,
  type RejectionCategory,
} from "../rcm/queue-routing";
import type { ClaimWorkRecord } from "./claim-work-drawer";
import { deriveClaimValidationIssues } from "./claim-error-guidance";
import { RejectionWorkDrawer } from "./rejection-work-drawer";
import { getClaimsQueueData, type ClaimsQueueRow } from "./claims-queue-repository";
import { getClaimWorkData } from "./workspace-repository";

type RejectionItem = {
  claim: ClaimsQueueRow;
  categories: RejectionCategory[];
  messages: string[];
  responseCode: string;
};

const categoryLabels: Record<RejectionCategory, string> = {
  patient: "Patient Information",
  subscriber: "Subscriber Information",
  provider: "Provider Information",
  payer: "Payer Information",
  diagnosis: "Diagnosis",
  procedure_modifier: "Procedure / Modifier",
  authorization: "Authorization",
  claim_format: "Claim Format",
  other: "Other",
};

function splitMessages(value: unknown) {
  return String(value ?? "")
    .split(/(?<=\.)\s+/)
    .map((message) => message.trim())
    .filter(Boolean);
}

function asDrawerClaim(row: ClaimsQueueRow): ClaimWorkRecord {
  return {
    id: row.id,
    patientControlNumber: String(row.patient_control_number ?? ""),
    payerClaimNumber: row.payer_claim_number ? String(row.payer_claim_number) : null,
    claimStatus: String(row.claim_status ?? "rejected"),
    serviceDateFrom: row.service_date_from ? String(row.service_date_from) : null,
    totalChargeCents: Number(row.total_charge_cents ?? 0),
    clientName: row.clientName,
    payerName: row.payerName,
    renderingProviderName: row.providerName,
  };
}

export function RejectionsPage() {
  const [items, setItems] = useState<RejectionItem[]>([]);
  const [payerId, setPayerId] = useState("");
  const [category, setCategory] = useState<RejectionCategory | "">("");
  const [activeClaimId, setActiveClaimId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await getClaimsQueueData();
      const rejected = data.filter((row) =>
        getOperationalHome({
          claimStatus: row.claim_status,
          latestResponseStatus: row.clearinghouseStatus,
          hasActiveDenial: row.hasActiveDenial,
          openBalanceCents: row.openBalanceCents,
        }) === "rejections",
      );

      const next = await Promise.all(rejected.map(async (claim): Promise<RejectionItem> => {
        const work = await getClaimWorkData(claim.id);
        const validationHold = String(claim.claim_status) === "validation_failed";
        const rejectionWorkMessages = (work?.workItems ?? [])
          .filter((row) =>
            row.workqueue_type === (validationHold ? "claim_validation" : "claim_rejection") &&
            !["completed", "cancelled"].includes(String(row.workqueue_status ?? "")),
          )
          .flatMap((row) => splitMessages(row.description));
        const latestRejectedResponse = validationHold ? undefined : (work?.responses ?? [])
          .find((row) => String(row.response_status ?? "").toLowerCase() === "rejected");
        const responseMessages = latestRejectedResponse
          ? splitMessages(latestRejectedResponse.response_message)
          : [];
        const exactFieldMessages = validationHold && work
          ? deriveClaimValidationIssues(work.claim, work.lines, work.diagnoses)
          : [];
        const messages = [...new Set([...exactFieldMessages, ...responseMessages, ...rejectionWorkMessages])];
        if (!messages.length && validationHold) messages.push("Claim failed validation. Review the highlighted fields and revalidate.");
        const categories = getRejectionCategories(messages.length ? messages : ["Other claim correction required."]);
        return {
          claim,
          categories,
          messages,
          responseCode: String(latestRejectedResponse?.response_code ?? ""),
        };
      }));
      setItems(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Rejections.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const payerQueues = useMemo(() => {
    const queues = new Map<string, { id: string; name: string; count: number }>();
    for (const item of items) {
      const id = String(item.claim.payer_id ?? "unassigned");
      const current = queues.get(id);
      queues.set(id, {
        id,
        name: item.claim.payerName || "Unassigned Payer",
        count: (current?.count ?? 0) + 1,
      });
    }
    return [...queues.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  useEffect(() => {
    if (!payerQueues.length) {
      setPayerId("");
      return;
    }
    if (!payerQueues.some((payer) => payer.id === payerId)) setPayerId(payerQueues[0].id);
  }, [payerQueues, payerId]);

  const payerItems = useMemo(
    () => items.filter((item) => String(item.claim.payer_id ?? "unassigned") === payerId),
    [items, payerId],
  );

  const categories = useMemo(() => {
    const seen = new Set<RejectionCategory>();
    const values: RejectionCategory[] = [];
    for (const item of payerItems) {
      for (const value of item.categories) {
        if (!seen.has(value)) {
          seen.add(value);
          values.push(value);
        }
      }
    }
    return values;
  }, [payerItems]);

  useEffect(() => {
    if (!categories.length) {
      setCategory("");
      return;
    }
    if (!category || !categories.includes(category)) setCategory(categories[0]);
  }, [categories, category]);

  const visible = payerItems.filter((item) => !category || item.categories.includes(category));
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("claim");
    if (!requested) return;
    const selected = items.find((item) => item.claim.id === requested);
    if (!selected) return;
    setPayerId(String(selected.claim.payer_id ?? "unassigned"));
    setCategory(selected.categories[0] ?? "");
    setActiveClaimId(selected.claim.id);
  }, [items]);
  const activeIndex = visible.findIndex((item) => item.claim.id === activeClaimId);
  const activeItem = activeIndex >= 0 ? visible[activeIndex] : null;

  function openAt(index: number) {
    const item = visible[index];
    if (item) setActiveClaimId(item.claim.id);
  }

  return (
    <>
      <div className="thera-page-header">
        <div>
          <div className="thera-eyebrow">REVENUE CYCLE</div>
          <h1>Rejections & Validation Holds</h1>
          <p>Correct claim-validation holds and clearinghouse rejections in one editable workqueue. Select an error to jump to its field.</p>
        </div>
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {loading && <div className="thera-state">Loading Rejections...</div>}

      {!loading && !items.length && <section className="thera-card"><div className="thera-empty">No claims currently require rejection correction.</div></section>}

      {!loading && items.length > 0 && (
        <div className="thera-stack">
          <section className="thera-card">
            <div className="thera-card-header"><div><h2>Payer Workqueues</h2><p>Select the payer whose rejected claims you are correcting.</p></div></div>
            <div className="thera-filter-row" style={{ flexWrap: "wrap" }}>
              {payerQueues.map((payer) => (
                <button
                  type="button"
                  key={payer.id}
                  className={payerId === payer.id ? "thera-action" : "thera-action secondary"}
                  onClick={() => { setPayerId(payer.id); setActiveClaimId(null); }}
                >
                  {payer.name} ({payer.count})
                </button>
              ))}
            </div>
          </section>

          <div className="thera-tabs" role="tablist" aria-label="Rejection categories">
            {categories.map((value) => {
              const count = payerItems.filter((item) => item.categories.includes(value)).length;
              return (
                <button
                  type="button"
                  role="tab"
                  aria-selected={category === value}
                  key={value}
                  className={category === value ? "thera-tab active" : "thera-tab"}
                  onClick={() => { setCategory(value); setActiveClaimId(null); }}
                >
                  {categoryLabels[value]} ({count})
                </button>
              );
            })}
          </div>

          <section className="thera-card">
            <div className="thera-table-wrap">
              <table className="thera-table">
                <thead><tr><th>Claim</th><th>Patient</th><th>DOS</th><th>Provider</th><th>Charge</th><th>Rejection Code</th><th>Correction Needed</th><th>Action</th></tr></thead>
                <tbody>
                  {visible.map((item) => (
                    <tr key={item.claim.id}>
                      <td>{String(item.claim.patient_control_number ?? item.claim.id)}</td>
                      <td>{item.claim.clientName}</td>
                      <td>{shortDate(String(item.claim.service_date_from ?? ""))}</td>
                      <td>{item.claim.providerName}</td>
                      <td>{money(Number(item.claim.total_charge_cents ?? 0))}</td>
                      <td>{item.responseCode || "—"}</td>
                      <td>{item.messages.filter((message) => getRejectionCategories([message]).includes(category || "other")).join(" ") || categoryLabels[category || "other"]}</td>
                      <td><button type="button" className="thera-action" onClick={() => setActiveClaimId(item.claim.id)}>Correct Claim</button></td>
                    </tr>
                  ))}
                  {!visible.length && <tr><td colSpan={8}>No rejected claims match this correction category.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      <RejectionWorkDrawer
        claim={activeItem ? asDrawerClaim(activeItem.claim) : null}
        messages={activeItem?.messages ?? []}
        open={Boolean(activeItem)}
        onOpenChange={(open) => {
          if (!open) {
            setActiveClaimId(null);
            const url = new URL(window.location.href);
            if (url.searchParams.has("claim")) { url.searchParams.delete("claim"); window.history.replaceState(null, "", url.pathname + url.search + url.hash); }
            void load();
          }
        }}
        queuePosition={activeItem ? `${activeIndex + 1} of ${visible.length}` : undefined}
        onPrevious={() => openAt(activeIndex - 1)}
        onNext={() => openAt(activeIndex + 1)}
        previousDisabled={activeIndex <= 0}
        nextDisabled={activeIndex < 0 || activeIndex >= visible.length - 1}
      />
    </>
  );
}
