import { useEffect, useState } from "react";
import { authenticatedFetch, SUPABASE_URL } from "../../lib/supabase-client";
import { requireActiveTenantId } from "../../lib/tenant-session";
import { tenantSelect, type Row } from "../../lib/tenant-data-client";
type Normalized = {
  npi: string;
  specialties: { code: string }[];
  telecom: { workEmails: string[]; clinicPhones: string[] };
  taxonomyVersion: string;
};
type Saved = Row & {
  id: string;
  source: string;
  external_id: string;
  normalized: Normalized;
  updated_at: string;
};
export function PractitionerRoleImport() {
  const [source, setSource] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Normalized | null>(null);
  const [rows, setRows] = useState<Saved[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function load() {
    setRows(
      await tenantSelect<Saved>("practitioner_role_imports", {
        order: "updated_at.desc",
        limit: "50",
      }),
    );
  }
  useEffect(() => {
    load().catch(() => setError("Unable to load provider role imports."));
  }, []);
  async function submit(save: boolean) {
    if (!file || !source.trim()) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (file.size > 250000)
        throw Error("Choose a JSON file smaller than 250 KB.");
      let resource: unknown;
      try {
        resource = JSON.parse(await file.text());
      } catch {
        throw Error("The selected file is not valid JSON.");
      }
      const response = await authenticatedFetch(
        `${SUPABASE_URL}/functions/v1/fhir-practitioner-role`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenant_id: requireActiveTenantId(),
            source,
            resource,
            preview: !save,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw Error(
          data.issue?.[0]?.diagnostics ||
            data.message ||
            "Unable to import this provider role.",
        );
      setPreview(data.normalized);
      if (save) {
        setPreview(null);
        setFile(null);
        setMessage(
          "Provider role saved. Reimporting the same source and role ID updates that record.",
        );
        await load();
      }
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="thera-card" style={{ marginBottom: 16 }}>
      <div className="thera-card-header">
        <div>
          <h2>Provider directory import</h2>
          <p>
            Upload one FHIR PractitionerRole JSON file. Its NPI must match an
            existing provider in this practice.
          </p>
        </div>
      </div>
      <div style={{ padding: 16, display: "grid", gap: 12 }}>
        <label>
          Directory source
          <input
            aria-label="Directory source"
            value={source}
            maxLength={120}
            disabled={busy}
            onChange={(e) => {
              setSource(e.target.value);
              setPreview(null);
            }}
          />
        </label>
        <label>
          PractitionerRole JSON
          <input
            aria-label="PractitionerRole JSON"
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setMessage("");
            }}
          />
        </label>
        <p>
          Only directory feeds that include the practitioner NPI in the role’s
          identifier list are supported. Role contact details are stored
          separately from your provider profile.
        </p>
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        <div>
          <button
            className="thera-action secondary"
            disabled={busy || !file || !source.trim()}
            onClick={() => submit(false)}
          >
            {busy ? "Working…" : "Validate file"}
          </button>
          {preview && (
            <button
              className="thera-action"
              disabled={busy}
              onClick={() => submit(true)}
            >
              Save provider role
            </button>
          )}
        </div>
        {preview && (
          <div role="status">
            <strong>NPI {preview.npi}</strong>
            <p>
              Specialties:{" "}
              {preview.specialties.map((s) => s.code).join(", ") || "None"}
            </p>
            <p>
              Work emails: {preview.telecom.workEmails.join(", ") || "None"}
            </p>
            <p>
              Clinic phones: {preview.telecom.clinicPhones.join(", ") || "None"}
            </p>
          </div>
        )}
        <h3>Recent provider role imports</h3>
        {rows.length === 0 ? (
          <p>No provider roles imported yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="thera-table">
              <thead>
                <tr>
                  <th>NPI</th>
                  <th>Source / Role</th>
                  <th>Specialties</th>
                  <th>Work emails</th>
                  <th>Clinic phones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.normalized.npi}</td>
                    <td>
                      {row.source} / {row.external_id}
                    </td>
                    <td>
                      {row.normalized.specialties.map((s) => s.code).join(", ")}
                    </td>
                    <td>{row.normalized.telecom.workEmails.join(", ")}</td>
                    <td>{row.normalized.telecom.clinicPhones.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
