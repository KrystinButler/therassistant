import { useState, type FormEvent } from "react";

import { useTenant } from "./tenant-context";

export function OrganizationSetup() {
  const { bootstrapOrganization } = useTenant();
  const [name, setName] = useState("");
  const [type, setType] = useState<"billing_company" | "practice">("billing_company");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setWorking(true);
    setError(null);
    try {
      await bootstrapOrganization(name, type);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create your organization.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="thera-main" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <form className="thera-card" style={{ width: "min(520px, 100%)" }} onSubmit={submit}>
        <div className="thera-brand" style={{ marginBottom: 24 }}>
          <div className="thera-brand-mark">T</div>
          <div>
            <div className="thera-brand-name">THERASSISTANT</div>
            <div className="thera-brand-subtitle">Revenue Cycle Operations</div>
          </div>
        </div>
        <div className="thera-card-header">
          <div>
            <h1>Set up your organization</h1>
            <p>Create the organization your authorized account will administer.</p>
          </div>
        </div>
        <label style={{ display: "grid", gap: 6, marginBottom: 16 }}>
          <span className="thera-field-label">Organization name</span>
          <input
            name="organization-name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Organization name"
            style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--thera-border, #d7d7d2)" }}
          />
        </label>
        <label style={{ display: "grid", gap: 6, marginBottom: 20 }}>
          <span className="thera-field-label">Organization type</span>
          <select
            name="organization-type"
            value={type}
            onChange={(event) => setType(event.target.value as "billing_company" | "practice")}
            style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--thera-border, #d7d7d2)" }}
          >
            <option value="billing_company">Billing company</option>
            <option value="practice">Healthcare practice</option>
          </select>
        </label>
        {error ? <div className="thera-state error" style={{ marginBottom: 16 }}>{error}</div> : null}
        <button type="submit" className="thera-action" disabled={working} style={{ width: "100%" }}>
          {working ? "Creating organization..." : "Create organization"}
        </button>
      </form>
    </main>
  );
}
