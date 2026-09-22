import { money, shortDate } from "../../lib/format";

type Row = Record<string, unknown> & { id?: string };

type Props = {
  claim: Row & { clientName?: string; providerName?: string; payerName?: string };
  client: Row | null;
  insurance: Row | null;
  renderingProvider: Row | null;
  billingProvider: Row | null;
  practiceEntity: Row | null;
  practiceLocation: Row | null;
  lines: Row[];
  diagnoses: Row[];
};

function text(value: unknown, fallback = "") {
  return value == null || value === "" ? fallback : String(value);
}

function fullName(row: Row | null) {
  if (!row) return "";
  return [row.last_name, row.first_name, row.middle_name].filter(Boolean).join(", ");
}

function address(row: Row | null) {
  if (!row) return "";
  const street = [row.address_line1, row.address_line2].filter(Boolean).join(" ");
  const cityStateZip = [row.city, row.state, row.postal_code].filter(Boolean).join(" ");
  return [street, cityStateZip].filter(Boolean).join(" · ");
}

function Box({ number, label, value, warning }: { number: string; label: string; value?: React.ReactNode; warning?: boolean }) {
  return (
    <div style={{
      border: warning ? "2px solid #a63c3c" : "1px solid #929292",
      padding: "7px 8px",
      minHeight: 48,
      background: warning ? "#fff7f7" : "#fff",
    }}>
      <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
        <strong style={{ fontSize: 11 }}>{number}</strong>
        <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</span>
      </div>
      <div style={{ fontSize: 12, marginTop: 4, fontWeight: 600 }}>{value || "—"}</div>
    </div>
  );
}

export function Cms1500Preview({
  claim,
  client,
  insurance,
  renderingProvider,
  billingProvider,
  practiceEntity,
  practiceLocation,
  lines,
  diagnoses,
}: Props) {
  const diagnosisByOrder = new Map(diagnoses.map((row) => [Number(row.pointer_order ?? 0), text(row.diagnosis_code)]));
  const missing: string[] = [];
  if (!insurance?.member_id) missing.push("Box 1a — Insured ID");
  if (!client?.date_of_birth) missing.push("Box 3 — Patient DOB");
  if (!client?.address_line1) missing.push("Box 5 — Patient address");
  if (!diagnoses.length) missing.push("Box 21 — Diagnosis");
  if (!lines.length) missing.push("Box 24 — Service line");
  if (!renderingProvider?.individual_npi) missing.push("Box 24J — Rendering NPI");
  if (!practiceEntity?.tax_id) missing.push("Box 25 — Tax ID");
  if (!practiceEntity?.group_npi && !billingProvider?.individual_npi) missing.push("Box 33a — Billing NPI");

  return (
    <div className="thera-stack">
      <section className="thera-card">
        <div className="thera-card-header">
          <div>
            <div className="thera-eyebrow">PROFESSIONAL CLAIM PREVIEW</div>
            <h2>CMS-1500 (02/12)</h2>
            <p>Live rendering of the current claim record. This preview is not a separately stored claim copy.</p>
          </div>
          <button type="button" className="thera-action secondary" onClick={() => window.print()}>Print Preview</button>
        </div>
        {missing.length ? (
          <div className="thera-state error" style={{ marginTop: 12 }}>
            <strong>{missing.length} field{missing.length === 1 ? "" : "s"} need attention:</strong> {missing.join(" · ")}
          </div>
        ) : (
          <div className="thera-alert" style={{ marginTop: 12 }}>CMS-1500 preview has the core data required for visual claim review.</div>
        )}
      </section>

      <section className="thera-card" style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 980, background: "#faf8f2", border: "2px solid #6d6d6d", padding: 8 }}>
          <div style={{ textAlign: "center", fontWeight: 800, fontSize: 18, marginBottom: 8 }}>
            HEALTH INSURANCE CLAIM FORM
            <div style={{ fontSize: 10, fontWeight: 500 }}>CMS-1500 · VERSION 02/12 · PREVIEW</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 0 }}>
            <Box number="1" label="Type of insurance" value={claim.payerName || text(claim.payer_id)} />
            <Box number="1a" label="Insured's ID number" value={text(insurance?.member_id)} warning={!insurance?.member_id} />
            <Box number="2" label="Patient's name" value={fullName(client) || claim.clientName} />
            <Box number="3" label="Patient birth date" value={client?.date_of_birth ? shortDate(text(client.date_of_birth)) : ""} warning={!client?.date_of_birth} />

            <Box number="4" label="Insured's name" value={text(insurance?.subscriber_name) || fullName(client)} />
            <Box number="5" label="Patient address" value={address(client)} warning={!client?.address_line1} />
            <Box number="6" label="Relationship to insured" value={text(insurance?.relationship_to_subscriber, "Self")} />
            <Box number="7" label="Insured address" value={text((insurance?.metadata as Record<string, unknown> | undefined)?.subscriber_address) || address(client)} />

            <Box number="11" label="Insured policy/group" value={text(insurance?.group_number)} />
            <Box number="11a" label="Insured DOB" value={insurance?.subscriber_dob ? shortDate(text(insurance.subscriber_dob)) : ""} />
            <Box number="12" label="Patient signature" value="Signature on file" />
            <Box number="13" label="Insured signature" value="Signature on file" />
          </div>

          <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "2fr 1fr", gap: 0 }}>
            <Box
              number="21"
              label="Diagnosis or nature of illness or injury"
              warning={!diagnoses.length}
              value={
                diagnoses.length
                  ? diagnoses.slice(0, 12).map((row) => `${String.fromCharCode(64 + Number(row.pointer_order ?? 1))}. ${text(row.diagnosis_code)}`).join("   ")
                  : ""
              }
            />
            <Box number="23" label="Prior authorization number" value={text(claim.prior_authorization_number)} />
          </div>

          <div style={{ marginTop: 8, border: "1px solid #929292", background: "#fff" }}>
            <div style={{ display: "grid", gridTemplateColumns: "110px 45px 150px 70px 90px 55px 1fr", fontSize: 9, fontWeight: 800, textTransform: "uppercase" }}>
              {["24A Date", "24B POS", "24D Procedure / Modifiers", "24E Dx", "24F Charge", "24G Units", "24J Rendering NPI"].map((label) => (
                <div key={label} style={{ padding: 6, borderRight: "1px solid #929292" }}>{label}</div>
              ))}
            </div>
            {(lines.length ? lines : [{ id: "empty" }]).slice(0, 6).map((line, index) => {
              const pointerRaw = text(line.diagnosis_pointer);
              const pointerNumbers = pointerRaw.split(/[^0-9]+/).filter(Boolean).map(Number);
              const pointerDisplay = pointerNumbers.length
                ? pointerNumbers.map((n) => String.fromCharCode(64 + n)).join(",")
                : pointerRaw;
              const mods = [line.modifier1, line.modifier2, line.modifier3, line.modifier4].filter(Boolean).map(String).join(" ");
              return (
                <div key={text(line.id, String(index))} style={{ display: "grid", gridTemplateColumns: "110px 45px 150px 70px 90px 55px 1fr", fontSize: 11, minHeight: 36, borderTop: "1px solid #929292" }}>
                  <div style={{ padding: 6, borderRight: "1px solid #929292" }}>{line.service_date ? shortDate(text(line.service_date)) : "—"}</div>
                  <div style={{ padding: 6, borderRight: "1px solid #929292" }}>{text(line.place_of_service)}</div>
                  <div style={{ padding: 6, borderRight: "1px solid #929292" }}>{[text(line.cpt_code), mods].filter(Boolean).join(" ")}</div>
                  <div style={{ padding: 6, borderRight: "1px solid #929292" }}>{pointerDisplay || (diagnosisByOrder.size ? "A" : "")}</div>
                  <div style={{ padding: 6, borderRight: "1px solid #929292" }}>{line.charge_amount_cents != null ? money(Number(line.charge_amount_cents)) : "—"}</div>
                  <div style={{ padding: 6, borderRight: "1px solid #929292" }}>{text(line.units, "1")}</div>
                  <div style={{ padding: 6 }}>{text(renderingProvider?.individual_npi)}</div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 2fr", gap: 0 }}>
            <Box number="25" label="Federal tax ID" value={text(practiceEntity?.tax_id)} warning={!practiceEntity?.tax_id} />
            <Box number="26" label="Patient account #" value={text(claim.patient_control_number)} />
            <Box number="28" label="Total charge" value={money(Number(claim.total_charge_cents ?? 0))} />
            <Box number="31" label="Signature of physician/supplier" value={claim.providerName || fullName(renderingProvider)} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
            <Box number="32" label="Service facility location" value={[text(practiceLocation?.name), address(practiceLocation)].filter(Boolean).join(" · ")} />
            <Box
              number="33"
              label="Billing provider / billing NPI"
              warning={!practiceEntity?.group_npi && !billingProvider?.individual_npi}
              value={[
                text(practiceEntity?.legal_name) || text(practiceEntity?.dba_name) || fullName(billingProvider),
                address(practiceLocation),
                `NPI ${text(practiceEntity?.group_npi) || text(billingProvider?.individual_npi)}`,
              ].filter((value) => value && !value.endsWith("NPI ")).join(" · ")}
            />
          </div>
        </div>
      </section>

      {lines.length > 6 ? (
        <section className="thera-card">
          <strong>Additional service lines:</strong> {lines.length - 6}. The electronic claim retains all service lines; this preview shows the first six on page 1.
        </section>
      ) : null}
    </div>
  );
}
