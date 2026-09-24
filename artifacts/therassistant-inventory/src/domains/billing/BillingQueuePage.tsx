import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

import { StatusBadge } from "../../components/status-badge";
import { dateTime, money, shortDate } from "../../lib/format";
import {
  createBatch,
  createClaimFromCharges,
  getClaimSubmissionData,
  recordExternalClaimAcknowledgement,
  recordExternalSubmission,
  validateClaim,
} from "../claims/repository";
import { buildCms1500PreviewHtml } from "./cms1500-preview";
import { getPrivatePaySuperbillData } from "./superbill-repository";
import { buildSuperbillHtml } from "./superbill";
import { getClaimPreviewData } from "./claim-output-repository";
import { archiveBatch837PArtifact } from "./claim-artifact-repository";
import {
  createChargeFromEncounter,
  getBillingQueueData,
} from "./repository";

type BillingData = Awaited<ReturnType<typeof getBillingQueueData>>;
type ClaimsData = Awaited<ReturnType<typeof getClaimSubmissionData>>;
type ChargesData = { billing: BillingData; claims: ClaimsData };
type ChargesTab = "ready" | "blocked" | "program" | "private-pay" | "unbatched" | "batches" | "submitted";

export function BillingQueuePage() {
  const [data, setData] = useState<ChargesData | null>(null);
  const [tab, setTab] = useState<ChargesTab>("ready");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [billing, claims] = await Promise.all([
        getBillingQueueData(),
        getClaimSubmissionData(),
      ]);
      setData({ billing, claims });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Charges.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const groups = useMemo(() => {
    if (!data) {
      return {
        ready: [],
        blocked: [],
        readyCharges: [],
        programCharges: [],
        privatePayCharges: [],
        preBatchClaims: [],
        readyForBatch: [],
        openBatches: [],
        submittedBatches: [],
      };
    }

    const ready = data.billing.encounters.filter(
      (row) =>
        ["ready", "not_ready"].includes(String(row.billing_status)) &&
        !data.billing.chargesByEncounter.get(row.id)?.length,
    );
    const blocked = data.billing.encounters.filter(
      (row) => row.billing_status === "held" || row.blockingChecks.length > 0,
    );

    return {
      ready,
      blocked,
      readyCharges: data.billing.charges.filter((row) => row.charge_status === "ready_for_claim"),
      programCharges: data.billing.charges.filter((row) => row.charge_status === "program_billing"),
      privatePayCharges: data.billing.charges.filter((row) => row.charge_status === "patient_responsibility"),
      preBatchClaims: data.claims.claims.filter((claim) =>
        ["ready_for_validation", "ready_for_batch"].includes(String(claim.claim_status)),
      ),
      readyForBatch: data.claims.claims.filter((claim) => claim.claim_status === "ready_for_batch"),
      openBatches: data.claims.batches.filter((batch) => ["created", "ready"].includes(String(batch.batch_status))),
      submittedBatches: data.claims.batches.filter((batch) => batch.batch_status === "submitted"),
    };
  }, [data]);

  async function runEncounterAction(id: string, action: "audit" | "charge") {
    setSavingId(id);
    setError(null);
    setMessage(null);
    try {
      const result = await createChargeFromEncounter(id);
      if (!result.ok) {
        setError(result.details?.length ? `${result.message} ${result.details.join(" ")}` : result.message);
        return;
      }
      setMessage(action === "audit" ? "Billing-readiness audit completed and charge state reconciled." : "Charge created.");
      if (action === "charge") setTab("unbatched");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to complete charge action.");
    } finally {
      setSavingId(null);
    }
  }

  async function runBatchCreateCharges(ids: string[]) {
    if (!data || !ids.length || savingId) return;
    const eligible = groups.ready.filter((row) =>
      ids.includes(row.id) && row.billing_status === "ready" &&
      !row.blockingChecks.length && !(data.billing.chargesByEncounter.get(row.id)?.length),
    );
    if (!eligible.length) {
      setError("Select encounters that are ready for billing and have no existing charges.");
      return;
    }
    setSavingId("batch-charges");
    setError(null);
    setMessage(null);
    let created = 0;
    const failures: string[] = [];
    try {
      // Process serially so each encounter is independently validated and failures
      // do not create duplicate charges or stop the remaining selected work.
      for (const row of eligible) {
        try {
          const result = await createChargeFromEncounter(row.id);
          if (result.ok) created += 1;
          else failures.push(`${row.clientName}: ${result.message}`);
        } catch (err) {
          failures.push(`${row.clientName}: ${err instanceof Error ? err.message : "Unable to create charge."}`);
        }
      }
      await load();
      setMessage(`${created} of ${eligible.length} selected encounters had charges created.`);
      if (failures.length) setError(`${failures.length} encounter(s) require review: ${failures.join(" · ")}`);
    } finally {
      setSavingId(null);
    }
  }

  async function runCreateClaim(encounterId: string) {
    if (!data) return;
    const chargeIds = (data.billing.chargesByEncounter.get(encounterId) ?? [])
      .filter((charge) => charge.charge_status === "ready_for_claim")
      .map((charge) => charge.id);

    if (!chargeIds.length) {
      setError("No ready charges are available for claim creation.");
      return;
    }

    setSavingId(encounterId);
    setError(null);
    setMessage(null);
    try {
      const created = await createClaimFromCharges(chargeIds);
      if (!created.ok) {
        setError(created.details?.length ? `${created.message} ${created.details.join(" ")}` : created.message);
        return;
      }

      const claimId = String(created.value.claim.id);
      const validation = await validateClaim(claimId);
      if (!validation.ok) {
        const validationDetails = validation.details?.length
          ? validation.details.join(" ")
          : validation.message;
        const disposition = validation.blocked
          ? "was created and moved to Rejections for correction"
          : "was created, but the claim scrub could not complete";
        setMessage(
          `Claim ${String(created.value.claim.patient_control_number || "created")} ${disposition}. ${validationDetails}`,
        );
      } else {
        setMessage(`Claim ${String(created.value.claim.patient_control_number || "created")} passed scrub and is ready to batch.`);
      }
      setTab("unbatched");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create claim.");
    } finally {
      setSavingId(null);
    }
  }

  async function runValidate(claimId: string) {
    setSavingId(claimId);
    setError(null);
    setMessage(null);
    try {
      const result = await validateClaim(claimId);
      if (!result.ok) {
        setMessage("Claim scrub failed and the claim moved to Rejections for correction.");
      } else {
        setMessage("Claim scrub passed and the claim is ready to batch.");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to validate claim.");
    } finally {
      setSavingId(null);
    }
  }

  async function runCreatePayerBatch(payerId: string) {
    if (!data) return;
    const claims = groups.readyForBatch.filter((claim) => String(claim.payer_id ?? "") === payerId);
    if (!claims.length) {
      setError("No validated claims are ready for this payer.");
      return;
    }

    const payerNames = new Set(claims.map((claim) => claim.payerName));
    const payerIds = new Set(claims.map((claim) => String(claim.payer_id ?? "")));
    if (payerIds.size !== 1) {
      setError("A claim batch must contain one payer only.");
      return;
    }

    setSavingId(`batch-${payerId}`);
    setError(null);
    setMessage(null);
    try {
      const payerName = [...payerNames][0] || "Payer";
      const result = await createBatch(
        claims.map((claim) => claim.id),
        `${payerName} ${new Date().toISOString().slice(0, 10)}`,
      );
      if (!result.ok) {
        setError(result.details?.length ? `${result.message} ${result.details.join(" ")}` : result.message);
        return;
      }
      setMessage(`Payer batch created with ${result.value.claimCount} claim(s).`);
      setTab("batches");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create payer batch.");
    } finally {
      setSavingId(null);
    }
  }

  async function runRecordExternalSubmission(batchId: string) {
    const externalReference = window.prompt(
      "Enter the clearinghouse confirmation, file receipt, or other external submission reference.",
    )?.trim();
    if (!externalReference) return;

    const confirmed = window.confirm(
      "Confirm that this 837P batch was actually transmitted outside THERASSISTANT. This will mark the batch and its claims as submitted.",
    );
    if (!confirmed) return;

    setSavingId(batchId);
    setError(null);
    setMessage(null);
    try {
      const result = await recordExternalSubmission(batchId, externalReference);
      if (!result.ok) {
        setError(result.details?.length ? `${result.message} ${result.details.join(" ")}` : result.message);
        return;
      }
      setMessage(`External 837P submission recorded for ${result.value.claimCount} claim(s).`);
      setTab("submitted");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to record external submission.");
    } finally {
      setSavingId(null);
    }
  }

  async function runRecordAcknowledgement(
    submissionId: string,
    claimId: string,
    outcome: "accepted" | "rejected",
  ) {
    const acknowledgementType = window.prompt(
      "Acknowledgement source: 999, 277CA, clearinghouse_portal, or other.",
      "277CA",
    )?.trim();
    if (!acknowledgementType || !["999", "277CA", "clearinghouse_portal", "other"].includes(acknowledgementType)) {
      setError("Choose a valid acknowledgement source: 999, 277CA, clearinghouse_portal, or other.");
      return;
    }

    const responseCode = window.prompt("Enter the external acknowledgement response/status code.")?.trim();
    if (!responseCode) return;
    const responseMessage = window.prompt("Enter the clearinghouse response message or rejection description.")?.trim();
    if (!responseMessage) return;
    const externalReference = window.prompt(
      "Enter the acknowledgement file, clearinghouse receipt, or portal reference.",
    )?.trim();
    if (!externalReference) return;

    setSavingId(`ack-${claimId}`);
    setError(null);
    setMessage(null);
    try {
      const result = await recordExternalClaimAcknowledgement({
        submissionId,
        claimId,
        outcome,
        acknowledgementType: acknowledgementType as "999" | "277CA" | "clearinghouse_portal" | "other",
        responseCode,
        responseMessage,
        externalReference,
      });
      if (!result.ok) {
        setError(result.details?.length ? `${result.message} ${result.details.join(" ")}` : result.message);
        return;
      }
      setMessage(
        `${acknowledgementType} ${outcome} acknowledgement recorded. Submission status: ${result.value.submissionStatus.replaceAll("_", " ")}.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to record external acknowledgement.");
    } finally {
      setSavingId(null);
    }
  }

  async function runDownload837(batchId: string) {
    setSavingId(`download-${batchId}`);
    setError(null);
    setMessage(null);
    try {
      const artifact = await archiveBatch837PArtifact(batchId);
      const blob = new Blob([artifact.text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = artifact.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage(`837P archived and verified (SHA-256 ${artifact.sha256.slice(0, 12)}…). The batch is transmission-ready but remains unsubmitted.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to archive and download the 837P.");
    } finally {
      setSavingId(null);
    }
  }
  async function runCms1500Preview(claimId: string, autoPrint = false) {
    const actionId = `${autoPrint ? "print" : "preview"}-${claimId}`;
    const previewWindow = window.open("", "_blank");
    if (!previewWindow) {
      setError("Allow pop-ups to preview CMS-1500.");
      return;
    }
    previewWindow.opener = null;
    previewWindow.document.write("<p style='font-family:Arial,sans-serif;padding:24px'>Loading CMS-1500 preview…</p>");

    setSavingId(actionId);
    setError(null);
    try {
      const preview = await getClaimPreviewData(claimId);
      previewWindow.document.open();
      previewWindow.document.write(buildCms1500PreviewHtml(preview.item, preview.edi));
      previewWindow.document.close();
      previewWindow.focus();
      if (autoPrint) {
        window.setTimeout(() => previewWindow.print(), 75);
      }
    } catch (err) {
      previewWindow.close();
      setError(err instanceof Error ? err.message : "Unable to preview CMS-1500.");
    } finally {
      setSavingId(null);
    }
  }

  async function runSuperbillPreview(encounterId: string) {
    const previewWindow = window.open("", "_blank");
    if (!previewWindow) {
      setError("Allow pop-ups to preview the superbill.");
      return;
    }
    previewWindow.opener = null;
    previewWindow.document.write("<p style='font-family:Inter,Arial,sans-serif;padding:24px'>Preparing superbill…</p>");
    setSavingId("superbill-" + encounterId);
    setError(null);
    try {
      const superbill = await getPrivatePaySuperbillData(encounterId);
      previewWindow.document.open();
      previewWindow.document.write(buildSuperbillHtml(superbill));
      previewWindow.document.close();
      previewWindow.focus();
    } catch (err) {
      previewWindow.close();
      setError(err instanceof Error ? err.message : "Unable to generate superbill.");
    } finally {
      setSavingId(null);
    }
  }

  async function runPrintCms1500(_batchId: string, claimId: string) {
    await runCms1500Preview(claimId, true);
  }

  return (
    <>
      <div className="thera-page-header">
        <div>
          <div className="thera-eyebrow">GET PAID · STAGES 04–05</div>
          <h1>Charge Capture & Billing Routing</h1>
          <p>Route signed encounters to insurance claims, program invoice/voucher work, or private-pay responsibility without re-entering the clinical record.</p>
        </div>
      </div>

      <div className="thera-tabs" style={{ marginBottom: 16 }}>
        <Tab active={tab === "ready"} onClick={() => setTab("ready")} label={`Ready for Billing (${groups.ready.length})`} />
        <Tab active={tab === "blocked"} onClick={() => setTab("blocked")} label={`Validation Hold (${groups.blocked.length})`} />
        <Tab active={tab === "program"} onClick={() => setTab("program")} label={`Program Billing (${groups.programCharges.length})`} />
        <Tab active={tab === "private-pay"} onClick={() => setTab("private-pay")} label={`Private Pay (${groups.privatePayCharges.length})`} />
        <Tab active={tab === "unbatched"} onClick={() => setTab("unbatched")} label={`Insurance Claims (${groups.readyCharges.length + groups.preBatchClaims.length})`} title="Create insurance claims, check them for errors and prepare payer batches—nothing is transmitted here." />
        <Tab active={tab === "batches"} onClick={() => setTab("batches")} label={`837P Batches (${groups.openBatches.length})`} />
        <Tab active={tab === "submitted"} onClick={() => setTab("submitted")} label={`Submitted / Responses (${groups.submittedBatches.length})`} />
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="thera-alert" style={{ marginBottom: 12 }}>{message}</div>}
      {loading && <div className="thera-state">Loading Charges...</div>}

      {!loading && data && tab === "ready" && (
        <EncounterTable
          rows={groups.ready}
          data={data.billing}
          savingId={savingId}
          onAudit={(id) => void runEncounterAction(id, "audit")}
          onCharge={(id) => void runEncounterAction(id, "charge")}
          enableBatch
          onBatchCharge={(ids) => void runBatchCreateCharges(ids)}
        />
      )}

      {!loading && data && tab === "blocked" && (
        <EncounterTable
          rows={groups.blocked}
          data={data.billing}
          savingId={savingId}
          onAudit={(id) => void runEncounterAction(id, "audit")}
          onCharge={(id) => void runEncounterAction(id, "charge")}
        />
      )}

      {!loading && data && tab === "program" && (
        <FundingCharges
          rows={groups.programCharges}
          data={data.billing}
          heading="Program Invoice / Voucher Queue"
          description="These charges are intentionally excluded from CMS-1500 and 837P claim creation. Use the encounter funding reference to complete the applicable program billing process."
        />
      )}

      {!loading && data && tab === "private-pay" && (
        <FundingCharges
          rows={groups.privatePayCharges}
          data={data.billing}
          heading="Private Pay Responsibility"
          description="These charges are routed to private-pay responsibility rather than an insurance claim."
          showPaymentsLink
          savingId={savingId}
          onGenerateSuperbill={(encounterId) => void runSuperbillPreview(encounterId)}
        />
      )}

      {!loading && data && tab === "unbatched" && (
        <UnbatchedCharges
          data={data}
          savingId={savingId}
          onCreateClaim={(encounterId) => void runCreateClaim(encounterId)}
          onValidate={(claimId) => void runValidate(claimId)}
          onPreview={(claimId) => void runCms1500Preview(claimId)}
          onCreatePayerBatch={(payerId) => void runCreatePayerBatch(payerId)}
        />
      )}

      {!loading && data && tab === "batches" && (
        <BatchCards
          rows={groups.openBatches}
          claims={data.claims.claims}
          savingId={savingId}
          onRecordSubmission={(id) => void runRecordExternalSubmission(id)}
          onDownload={(id) => void runDownload837(id)}
          onPrint={(batchId, claimId) => void runPrintCms1500(batchId, claimId)}
        />
      )}

      {!loading && data && tab === "submitted" && (
        <SubmittedBatches
          rows={groups.submittedBatches}
          claims={data.claims.claims}
          submissions={data.claims.submissions}
          savingId={savingId}
          onDownload={(id) => void runDownload837(id)}
          onPrint={(batchId, claimId) => void runPrintCms1500(batchId, claimId)}
          onAcknowledge={(submissionId: string, claimId: string, outcome: "accepted" | "rejected") =>
            void runRecordAcknowledgement(submissionId, claimId, outcome)}
        />
      )}
    </>
  );
}

function Tab({ active, label, title, onClick }: { active: boolean; label: string; title?: string; onClick: () => void }) {
  return <button type="button" className={active ? "thera-tab active" : "thera-tab"} title={title} onClick={onClick}>{label}</button>;
}

function EncounterTable({
  rows,
  data,
  savingId,
  onAudit,
  onCharge,
  enableBatch = false,
  onBatchCharge,
}: {
  rows: BillingData["encounters"];
  data: BillingData;
  savingId: string | null;
  onAudit: (id: string) => void;
  onCharge: (id: string) => void;
  enableBatch?: boolean;
  onBatchCharge?: (ids: string[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  useEffect(() => { setSelectedIds(new Set()); }, [rows, enableBatch]);
  const eligible = rows.filter((row) =>
    row.billing_status === "ready" && !row.blockingChecks.length &&
    !(data.chargesByEncounter.get(row.id)?.length),
  );
  const eligibleIds = eligible.map((row) => row.id);
  const selectedEligible = eligibleIds.filter((id) => selectedIds.has(id));
  const allSelected = eligibleIds.length > 0 && selectedEligible.length === eligibleIds.length;

  if (!rows.length) return <section className="thera-card"><div className="thera-empty">No encounters in this queue.</div></section>;
  return (
    <section className="thera-card">
      {enableBatch && <div className="thera-card-header split">
        <div><h2>Ready encounters</h2><p>Select eligible encounters to create charges in one operation. Held or already-charged visits cannot be selected.</p></div>
        <button type="button" className="thera-action" disabled={!selectedEligible.length || Boolean(savingId)} onClick={() => onBatchCharge?.(selectedEligible)}>
          {savingId === "batch-charges" ? "Creating charges..." : `Create selected charges (${selectedEligible.length})`}
        </button>
      </div>}
      <div className="thera-table-wrap">
        <table className="thera-table">
          <thead><tr>
            {enableBatch && <th><input type="checkbox" aria-label="Select all eligible encounters" checked={allSelected} disabled={!eligibleIds.length || Boolean(savingId)} onChange={(event) => setSelectedIds(event.target.checked ? new Set(eligibleIds) : new Set())} /></th>}
            <th>DOS</th><th>Patient</th><th>Provider</th><th>Funding / Payer</th><th>Encounter</th><th>Billing</th><th>Blocking Issues</th><th>Advisories</th><th>Actions</th>
          </tr></thead>
          <tbody>
            {rows.map((row) => {
              const charges = data.chargesByEncounter.get(row.id) ?? [];
              const canCharge = row.billing_status === "ready" && !row.blockingChecks.length && !charges.length;
              return <tr key={row.id}>
                {enableBatch && <td><input type="checkbox" aria-label={`Select ${row.clientName} encounter`} checked={canCharge && selectedIds.has(row.id)} disabled={!canCharge || Boolean(savingId)} onChange={(event) => setSelectedIds((current) => {
                  const next = new Set(current);
                  if (event.target.checked) next.add(row.id); else next.delete(row.id);
                  return next;
                })} /></td>}
                <td>{shortDate(String(row.started_at ?? ""))}</td>
                <td>{row.clientName}</td>
                <td>{row.providerName}</td>
                <td>{row.payerName}</td>
                <td><StatusBadge value={String(row.encounter_status)} /></td>
                <td><StatusBadge value={String(row.billing_status)} /></td>
                <td>{row.blockingChecks.length ? <><StatusBadge value="blocked" /><div className="thera-table-subtext">{row.blockingChecks.map((check) => String(check.message)).join(" · ")}</div></> : "—"}</td>
                <td>{row.advisoryChecks.length ? <><StatusBadge value="needs_review" /><div className="thera-table-subtext">{row.advisoryChecks.map((check) => String(check.message)).join(" · ")}</div></> : "—"}</td>
                <td><div className="thera-filter-row"><Link className="thera-action secondary" href={`/encounters/${row.id}`}>Open Encounter</Link><button type="button" className="thera-action secondary" disabled={Boolean(savingId)} onClick={() => onAudit(row.id)}>Run Audit</button>{canCharge && <button type="button" className="thera-action" disabled={Boolean(savingId)} onClick={() => onCharge(row.id)}>Create Charge</button>}</div></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FundingCharges({
  rows,
  data,
  heading,
  description,
  showPaymentsLink = false,
  savingId,
  onGenerateSuperbill,
}: {
  rows: BillingData["charges"];
  data: BillingData;
  heading: string;
  description: string;
  showPaymentsLink?: boolean;
  savingId?: string | null;
  onGenerateSuperbill?: (encounterId: string) => void;
}) {
  const encounters = new Map(data.encounters.map((row) => [row.id, row]));
  const renderedSuperbills = new Set<string>();
  if (!rows.length) return <section className="thera-card"><div className="thera-empty">{showPaymentsLink ? "No private-pay charges yet. Once charges are created from a signed encounter, its superbill will be available here." : "No charges in this funding queue."}</div></section>;

  return <section className="thera-card">
    <div className="thera-card-header split">
      <div><h2>{heading}</h2><p>{description}</p></div>
      {showPaymentsLink && <Link className="thera-action secondary" href="/payments">Open Payments</Link>}
    </div>
    <div className="thera-table-wrap">
      <table className="thera-table">
        <thead><tr><th>DOS</th><th>Patient</th><th>Funding</th><th>Reference</th><th>Service</th><th>Charge</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{rows.map((charge) => {
          const encounterId = String(charge.encounter_id ?? "");
          const encounter = encounters.get(encounterId);
          const context = charge.funding_context && typeof charge.funding_context === "object"
            ? charge.funding_context as Record<string, unknown>
            : {};
          const reference = String(context.reference ?? "").trim();
          const showSuperbill = showPaymentsLink && Boolean(encounterId) && !renderedSuperbills.has(encounterId);
          if (showSuperbill) renderedSuperbills.add(encounterId);
          return <tr key={charge.id}>
            <td>{shortDate(String(charge.service_date ?? encounter?.started_at ?? ""))}</td>
            <td>{encounter?.clientName ?? "—"}</td>
            <td>{encounter?.payerName ?? String(charge.billing_path ?? "—").replaceAll("_", " ")}</td>
            <td>{reference || "—"}</td>
            <td>{String(charge.cpt_code ?? "—")}</td>
            <td>{money(Number(charge.charge_amount_cents ?? 0))}</td>
            <td><StatusBadge value={String(charge.charge_status ?? "")} /></td>
            <td><div className="thera-filter-row">{encounterId ? <Link className="thera-action secondary" href={`/encounters/${encounterId}`}>Open Encounter</Link> : "—"}{showSuperbill && <button type="button" className="thera-action" disabled={Boolean(savingId)} onClick={() => onGenerateSuperbill?.(encounterId)}>{savingId === "superbill-" + encounterId ? "Preparing…" : "Generate Superbill"}</button>}</div></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </section>;
}

function UnbatchedCharges({
  data,
  savingId,
  onCreateClaim,
  onValidate,
  onPreview,
  onCreatePayerBatch,
}: {
  data: ChargesData;
  savingId: string | null;
  onCreateClaim: (encounterId: string) => void;
  onValidate: (claimId: string) => void;
  onPreview: (claimId: string) => void;
  onCreatePayerBatch: (payerId: string) => void;
}) {
  const encounters = new Map(data.billing.encounters.map((row) => [row.id, row]));
  const readyCharges = data.billing.charges.filter((row) => row.charge_status === "ready_for_claim");
  const groupedCharges = new Map<string, typeof readyCharges>();
  for (const row of readyCharges) {
    const encounterId = String(row.encounter_id ?? "");
    const list = groupedCharges.get(encounterId) ?? [];
    list.push(row);
    groupedCharges.set(encounterId, list);
  }

  const preBatchClaims = data.claims.claims.filter((claim) =>
    ["ready_for_validation", "ready_for_batch"].includes(String(claim.claim_status)),
  );
  const claimsByPayer = new Map<string, typeof preBatchClaims>();
  for (const claim of preBatchClaims) {
    const payerId = String(claim.payer_id ?? "");
    const list = claimsByPayer.get(payerId) ?? [];
    list.push(claim);
    claimsByPayer.set(payerId, list);
  }

  return <div className="thera-stack">
    <section className="thera-card" style={{ borderLeft: "4px solid var(--thera-sage)" }}>
      <div className="thera-eyebrow">INSURANCE ONLY · BEFORE SUBMISSION</div>
      <h2 style={{ margin: "4px 0 6px" }}>Prepare Insurance Claims</h2>
      <p style={{ maxWidth: 780 }}>This is where ready insurance charges become claims. Each claim is checked for missing or invalid details before it can be grouped into a payer-specific 837P file. Nothing is sent to an insurer from this section.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 13 }}>
        {[
          ["01", "Create claim", "Convert captured charges into an insurance claim."],
          ["02", "Check for errors", "Review required fields and route failed checks to Rejections."],
          ["03", "Group by payer", "Create an 837P batch from claims that passed validation."],
        ].map(([number, label, detail]) => <div key={number} style={{ padding: 11, border: "1px solid var(--thera-border)", borderRadius: 8, background: "var(--thera-cream)" }}>
          <span className="thera-eyebrow">{number}</span>
          <strong style={{ display: "block", color: "var(--thera-navy)", fontSize: ".82rem", marginTop: 3 }}>{label}</strong>
          <p style={{ fontSize: ".73rem", margin: "4px 0 0" }}>{detail}</p>
        </div>)}
      </div>
    </section>
    {!groupedCharges.size && !claimsByPayer.size && <section className="thera-card"><div className="thera-empty">No insurance charges or claims require preparation. Create charges from Ready for Billing when signed encounters are available.</div></section>}
    {[...groupedCharges.entries()].map(([encounterId, charges]) => {
      const encounter = encounters.get(encounterId);
      const total = charges.reduce((sum, charge) => sum + Number(charge.charge_amount_cents ?? 0), 0);
      return <section className="thera-card" key={`charges-${encounterId || charges[0].id}`}>
        <div className="thera-card-header split">
          <div><h2>{encounter?.clientName ?? "Patient"} · {encounter?.payerName ?? "Payer"}</h2><p>{charges.length} charge line(s) · {money(total)}</p></div>
          {encounterId && <button type="button" className="thera-action" disabled={savingId === encounterId} onClick={() => onCreateClaim(encounterId)}>Create & Scrub Claim</button>}
        </div>
      </section>;
    })}

    {[...claimsByPayer.entries()].map(([payerId, claims]) => {
      const ready = claims.filter((claim) => claim.claim_status === "ready_for_batch");
      return <section className="thera-card" key={`payer-${payerId || claims[0].payerName}`}>
        <div className="thera-card-header split">
          <div><h2>{claims[0].payerName}</h2><p>{ready.length} validated claim(s) ready for this payer batch.</p></div>
          <button type="button" className="thera-action" disabled={!payerId || ready.length === 0 || savingId === `batch-${payerId}`} onClick={() => onCreatePayerBatch(payerId)}>Batch by Payer ({ready.length})</button>
        </div>
        <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Claim</th><th>DOS</th><th>Patient</th><th>Charge</th><th>Status</th><th>Action</th></tr></thead><tbody>{claims.map((claim) => <tr key={claim.id}><td><Link className="thera-table-link" href={`/claims/${claim.id}`}>{String(claim.patient_control_number || "Open")}</Link></td><td>{shortDate(String(claim.service_date_from ?? ""))}</td><td>{claim.clientName}</td><td>{money(Number(claim.total_charge_cents ?? 0))}</td><td><StatusBadge value={String(claim.claim_status)} /></td><td><div className="thera-filter-row"><button type="button" className="thera-action secondary" disabled={savingId === `preview-${claim.id}`} onClick={() => onPreview(claim.id)}>Preview CMS-1500</button>{claim.claim_status === "ready_for_validation" ? <button type="button" className="thera-action" disabled={savingId === claim.id} onClick={() => onValidate(claim.id)}>Scrub Claim</button> : <span className="thera-muted">Ready</span>}</div></td></tr>)}</tbody></table></div>
      </section>;
    })}
  </div>;
}

function BatchCards({
  rows,
  claims,
  savingId,
  onRecordSubmission,
  onDownload,
  onPrint,
}: {
  rows: ClaimsData["batches"];
  claims: ClaimsData["claims"];
  savingId: string | null;
  onRecordSubmission: (batchId: string) => void;
  onDownload: (batchId: string) => void;
  onPrint: (batchId: string, claimId: string) => void;
}) {
  const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
  if (!rows.length) return <section className="thera-card"><div className="thera-empty">No payer batches are ready.</div></section>;

  return <div className="thera-stack">{rows.map((batch) => <section className="thera-card" key={batch.id}>
    <div className="thera-card-header split"><div><h2>{String(batch.batch_name || "Payer Batch")}</h2><p>{batch.claimIds.length} claim(s) · {money(Number(batch.total_charge_cents ?? 0))}{batch.edi_archived_at ? ` · 837P archived ${dateTime(String(batch.edi_archived_at))}` : " · 837P not archived"}</p></div><div className="thera-filter-row"><Link className="thera-action secondary" href="/administration/practices">837P Configuration</Link><button type="button" className="thera-action secondary" disabled={savingId === `download-${batch.id}`} onClick={() => onDownload(batch.id)}>{batch.edi_archived_at ? "Download Archived 837P" : "Archive & Download 837P"}</button>{batch.batch_status === "ready" && <button type="button" className="thera-action" title={batch.edi_archived_at ? "Record a confirmed external transmission." : "Archive and verify the 837P before submission."} disabled={savingId === batch.id || !batch.edi_archived_at} onClick={() => onRecordSubmission(batch.id)}>Record External Submission</button>}</div></div>
    <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Claim</th><th>Patient</th><th>Payer</th><th>Charge</th><th>CMS-1500</th></tr></thead><tbody>{batch.claimIds.map((claimId: string) => { const claim = claimsById.get(claimId); return <tr key={claimId}><td>{claim ? <Link className="thera-table-link" href={`/claims/${claim.id}`}>{String(claim.patient_control_number || "Open")}</Link> : claimId}</td><td>{claim?.clientName ?? "—"}</td><td>{claim?.payerName ?? "—"}</td><td>{money(Number(claim?.total_charge_cents ?? 0))}</td><td><button type="button" className="thera-action secondary" disabled={!claim || savingId === `print-${claimId}`} onClick={() => claim && onPrint(batch.id, claim.id)}>Print CMS-1500</button></td></tr>; })}</tbody></table></div>
  </section>)}</div>;
}

function SubmittedBatches({
  rows,
  claims,
  submissions,
  savingId,
  onDownload,
  onPrint,
  onAcknowledge,
}: {
  rows: ClaimsData["batches"];
  claims: ClaimsData["claims"];
  submissions: ClaimsData["submissions"];
  savingId: string | null;
  onDownload: (batchId: string) => void;
  onPrint: (batchId: string, claimId: string) => void;
  onAcknowledge: (
    submissionId: string,
    claimId: string,
    outcome: "accepted" | "rejected",
  ) => void;
}) {
  const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
  if (!rows.length) return <section className="thera-card"><div className="thera-empty">No submitted payer batches.</div></section>;

  return <div className="thera-stack">{rows.map((batch) => {
    const submission = submissions.find((row) => String(row.batch_id ?? "") === batch.id);
    return <section className="thera-card" key={batch.id}>
      <div className="thera-card-header split"><div><h2>{String(batch.batch_name || "Submitted Batch")}</h2><p>Submitted {dateTime(String(batch.submitted_at ?? submission?.submitted_at ?? ""))}</p></div><button type="button" className="thera-action secondary" title={batch.edi_archived_at ? "Download the immutable archived 837P." : "This historical submission predates 837P archival; Therassistant will not recreate a file and label it as the transmitted artifact."} disabled={!batch.edi_archived_at || savingId === `download-${batch.id}`} onClick={() => onDownload(batch.id)}>{batch.edi_archived_at ? "Download Archived 837P" : "No Archived 837P"}</button></div>
      <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Claim</th><th>Patient</th><th>Status</th><th>Latest Acknowledgement</th><th>Actions</th></tr></thead><tbody>{batch.claimIds.map((claimId: string) => {
        const claim = claimsById.get(claimId);
        const response = submission?.responses
          ?.filter((row: Record<string, unknown>) => String(row.claim_id ?? "") === claimId)
          .sort((a: Record<string, unknown>, b: Record<string, unknown>) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0];
        const canAcknowledge = Boolean(
          claim &&
          submission &&
          ["submitted", "accepted", "rejected"].includes(String(claim.claim_status)),
        );
        return <tr key={claimId}>
          <td>{claim ? <Link className="thera-table-link" href={`/claims/${claim.id}`}>{String(claim.patient_control_number || "Open")}</Link> : claimId}</td>
          <td>{claim?.clientName ?? "—"}</td>
          <td>{claim ? <StatusBadge value={String(claim.claim_status)} /> : "—"}</td>
          <td>{response ? <><StatusBadge value={String(response.response_status)} /><div className="thera-table-subtext">{String(response.response_code ?? "")} {String(response.response_message ?? "")}</div></> : <span className="thera-muted">Awaiting external response</span>}</td>
          <td><div className="thera-filter-row">
            <button type="button" className="thera-action secondary" disabled={!claim || savingId === `print-${claimId}`} onClick={() => claim && onPrint(batch.id, claim.id)}>Print CMS-1500</button>
            <button type="button" className="thera-action" disabled={!canAcknowledge || savingId === `ack-${claimId}`} onClick={() => submission && claim && onAcknowledge(submission.id, claim.id, "accepted")}>Record Accepted</button>
            <button type="button" className="thera-action secondary" disabled={!canAcknowledge || savingId === `ack-${claimId}`} onClick={() => submission && claim && onAcknowledge(submission.id, claim.id, "rejected")}>Record Rejected</button>
          </div></td>
        </tr>;
      })}</tbody></table></div>
    </section>;
  })}</div>;
}
