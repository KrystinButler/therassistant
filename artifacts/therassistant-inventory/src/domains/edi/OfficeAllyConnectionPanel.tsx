import { useEffect, useState } from "react";
import {
  disconnectOfficeAllyConnection,
  getOfficeAllyConnectionStatus,
  saveOfficeAllyProductionConnection,
  saveOfficeAllyTestConnection,
  type OfficeAllyConnectionStatus,
} from "./office-ally-connection";
import { sendOfficeAllyTransaction } from "./office-ally";

const statusLabels: Record<OfficeAllyConnectionStatus["status"], string> = {
  not_connected: "Not connected",
  test_ready: "Test ready",
  production_connected: "Production connected",
  connection_error: "Connection error",
};

export function OfficeAllyConnectionPanel() {
  const [status, setStatus] = useState<OfficeAllyConnectionStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [accountLabel, setAccountLabel] = useState("");
  const [replaceMode, setReplaceMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getOfficeAllyConnectionStatus()
      .then((result) => {
        if (!active) return;
        setStatus(result);
        setAccountLabel(result.account_label ?? "");
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Unable to load Office Ally connection.");
      });
    return () => { active = false; };
  }, []);

  async function connectProduction() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await saveOfficeAllyProductionConnection({ apiKey, accountLabel });
      setStatus(result);
      setApiKey("");
      setReplaceMode(false);
      setMessage("Office Ally credentials were saved securely for this practice.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to connect Office Ally.");
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const productionConnected = status?.status === "production_connected";
      const result = productionConnected
        ? status
        : await saveOfficeAllyTestConnection(accountLabel || undefined);
      await sendOfficeAllyTransaction({
        environment: "test",
        transaction: "270/271",
        payload: {},
      });
      if (result) setStatus(result);
      setApiKey("");
      setReplaceMode(false);
      setMessage(
        productionConnected
          ? "Internal test passed without sending data to Office Ally. Production credentials were not changed."
          : "Test connection passed without sending data to Office Ally.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Office Ally test failed.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await disconnectOfficeAllyConnection();
      setStatus(result);
      setApiKey("");
      setAccountLabel("");
      setReplaceMode(false);
      setMessage("Office Ally was disconnected from this practice.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to disconnect Office Ally.");
    } finally {
      setBusy(false);
    }
  }

  const connected = status?.status === "production_connected";
  const showCredentialForm = !connected || replaceMode;

  return (
    <section className="thera-card" aria-labelledby="office-ally-connection-heading" style={{ marginBottom: 16 }}>
      <div className="thera-card-header split">
        <div>
          <div className="thera-eyebrow">CLEARINGHOUSE CONNECTION</div>
          <h2 id="office-ally-connection-heading">Office Ally</h2>
          <p>THERASSISTANT manages the EDI routing. Your practice owns its Office Ally account and connects it here once.</p>
        </div>
        <span className="thera-table-subtext">{status ? statusLabels[status.status] : "Loading..."}</span>
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {message && <div className="thera-alert" role="status" style={{ marginBottom: 12 }}>{message}</div>}
      {status?.last_error && <div className="thera-state error" style={{ marginBottom: 12 }}>{status.last_error}</div>}

      {connected && !replaceMode && (
        <div className="thera-alert" style={{ marginBottom: 12 }}>
          Production connected{status.account_label ? ` · ${status.account_label}` : ""}. The saved API Key is never displayed after connection.
        </div>
      )}

      {status?.status === "test_ready" && (
        <div className="thera-alert" style={{ marginBottom: 12 }}>
          Test ready. Synthetic transactions stay inside THERASSISTANT and are not transmitted to Office Ally.
        </div>
      )}

      {showCredentialForm && (
        <div className="thera-form-grid" style={{ marginBottom: 12 }}>
          <label className="thera-field">
            <span className="thera-field-label">Account Label</span>
            <input
              className="thera-input"
              value={accountLabel}
              onChange={(event) => setAccountLabel(event.target.value)}
              placeholder="Optional practice label"
            />
          </label>
          <label className="thera-field">
            <span className="thera-field-label">Office Ally API Key</span>
            <input
              className="thera-input"
              type="password"
              autoComplete="new-password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="API Key"
            />
          </label>
        </div>
      )}

      <div className="thera-filter-row">
        {showCredentialForm && (
          <button type="button" className="thera-action" disabled={busy || !apiKey.trim()} onClick={() => void connectProduction()}>
            {connected ? "Replace credentials" : "Connect Office Ally"}
          </button>
        )}
        {connected && !replaceMode && (
          <button type="button" className="thera-action secondary" disabled={busy} onClick={() => setReplaceMode(true)}>
            Replace credentials
          </button>
        )}
        <button type="button" className="thera-action secondary" disabled={busy} onClick={() => void testConnection()}>
          Test connection
        </button>
        {status && status.status !== "not_connected" && (
          <button type="button" className="thera-action secondary" disabled={busy} onClick={() => void disconnect()}>
            Disconnect
          </button>
        )}
      </div>
    </section>
  );
}
