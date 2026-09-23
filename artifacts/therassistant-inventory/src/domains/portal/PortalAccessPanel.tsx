import { useEffect, useState } from "react";

import {
  getClientPortalAccess,
  invitePatientPortal,
  revokeClientPortalAccess,
  restoreClientPortalAccess,
  type ClientPortalAccess,
} from "./staff-portal-access";

export function PortalAccessPanel({ clientId }: { clientId: string }) {
  const [access, setAccess] = useState<ClientPortalAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<"invite" | "revoke" | "restore" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setAccess(await getClientPortalAccess(clientId));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load portal access.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [clientId]);

  async function invite() {
    setWorking("invite");
    setError(null);
    setNotice(null);
    try {
      await invitePatientPortal(clientId);
      setNotice("Patient portal invitation sent.");
      await load();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to send portal invitation.",
      );
    } finally {
      setWorking(null);
    }
  }

  async function revoke() {
    setWorking("revoke");
    setError(null);
    setNotice(null);
    try {
      await revokeClientPortalAccess(clientId);
      setNotice("Patient portal access revoked.");
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to revoke portal access.",
      );
    } finally {
      setWorking(null);
    }
  }

  async function restore() {
    setWorking("restore");
    setError(null);
    setNotice(null);
    try {
      await restoreClientPortalAccess(clientId);
      setNotice("Patient portal access restored.");
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to restore portal access.",
      );
    } finally {
      setWorking(null);
    }
  }

  if (loading) {
    return (
      <section className="thera-card">
        <h2>Patient Portal</h2>
        <p>Loading portal access...</p>
      </section>
    );
  }

  return (
    <section className="thera-card">
      <div className="thera-card-header">
        <div>
          <h2>Patient Portal</h2>
          <p>Manage the patient identity that can access the secure portal.</p>
        </div>
      </div>

      {error ? (
        <div className="thera-state error" style={{ marginBottom: 12 }}>
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="thera-state" style={{ marginBottom: 12 }}>
          {notice}
        </div>
      ) : null}

      {!access ? (
        <>
          <p><strong>Status:</strong> Not enrolled</p>
          <p className="thera-muted">
            Send a secure invitation to the email currently saved on the patient record.
          </p>
          <button
            className="thera-action"
            type="button"
            disabled={working !== null}
            onClick={() => void invite()}
          >
            {working === "invite" ? "Sending..." : "Send Portal Invite"}
          </button>
        </>
      ) : null}

      {access?.status === "invited" ? (
        <>
          <p><strong>Status:</strong> Invitation pending</p>
          <p>
            Invitation sent to <strong>{access.invited_email}</strong>.
          </p>
          {access.invited_at ? (
            <p className="thera-muted">
              Sent {new Date(access.invited_at).toLocaleString()}.
            </p>
          ) : null}
        </>
      ) : null}

      {access?.status === "active" ? (
        <>
          <p><strong>Status:</strong> Active</p>
          <p>
            Portal identity: <strong>{access.invited_email}</strong>.
          </p>
          <button
            className="thera-action secondary"
            type="button"
            disabled={working !== null}
            onClick={() => void revoke()}
          >
            {working === "revoke" ? "Revoking..." : "Revoke Portal Access"}
          </button>
        </>
      ) : null}

      {access?.status === "revoked" ? (
        <>
          <p><strong>Status:</strong> Revoked</p>
          <p>
            The existing patient identity remains linked but cannot access portal
            data until staff restores access.
          </p>
          <button
            className="thera-action"
            type="button"
            disabled={working !== null}
            onClick={() => void restore()}
          >
            {working === "restore" ? "Restoring..." : "Restore Portal Access"}
          </button>
        </>
      ) : null}
    </section>
  );
}
