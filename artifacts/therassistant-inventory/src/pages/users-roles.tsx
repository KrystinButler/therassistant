import { useEffect, useState } from "react";

import {
  getCurrentTenantId,
  tenantRpc,
  tenantSelect,
} from "../lib/tenant-data-client";

type AdminUser = {
  tenant_user_id: string;
  user_id: string;
  status: string;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  roles: string[];
};

type ProviderLink = { id: string; tenant_id: string; user_id: string; provider_id: string; status: string };
type ProviderRecord = { id: string; first_name?: string | null; last_name?: string | null; provider_status?: string | null };

const ROLE_OPTIONS = [
  "practice_admin",
  "billing_company_admin",
  "billing_manager",
  "biller",
  "clinician",
  "front_desk",
  "credentialing_specialist",
  "read_only",
] as const;

function userName(user: AdminUser) {
  return user.display_name
    || [user.first_name, user.last_name].filter(Boolean).join(" ")
    || user.email
    || user.user_id;
}

export function UserRolesPage() {
  const [tenantId, setTenantId] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [providerLinks, setProviderLinks] = useState<ProviderLink[]>([]);
  const [providers, setProviders] = useState<ProviderRecord[]>([]);
  const [draftRoles, setDraftRoles] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [workingUserId, setWorkingUserId] = useState<string | null>(null);
  const [workingLinkId, setWorkingLinkId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const currentTenantId = await getCurrentTenantId();
      const [payload, links, providerRecords] = await Promise.all([
        tenantRpc<AdminUser[]>("list_tenant_users_admin", { p_tenant_id: currentTenantId }),
        tenantSelect<ProviderLink>("provider_user_links", { select: "id,tenant_id,user_id,provider_id,status" }),
        tenantSelect<ProviderRecord>("providers", { select: "id,first_name,last_name,provider_status" }),
      ]);
      if (!Array.isArray(payload)) throw new Error("Unable to load tenant users.");
      setTenantId(currentTenantId);
      setUsers(payload);
      setProviderLinks(links);
      setProviders(providerRecords);
      setDraftRoles(Object.fromEntries(payload.map((user) => [user.user_id, [...(user.roles ?? [])]])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load users and roles.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function toggleRole(userId: string, role: string) {
    setDraftRoles((current) => {
      const next = new Set(current[userId] ?? []);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return { ...current, [userId]: [...next] };
    });
  }

  async function saveRoles(user: AdminUser) {
    const roles = draftRoles[user.user_id] ?? [];
    if (roles.length === 0) {
      setError("Each tenant user must keep at least one role.");
      return;
    }

    setWorkingUserId(user.user_id);
    setError(null);
    setNotice(null);
    try {
      await tenantRpc("set_tenant_user_roles", {
        p_tenant_id: tenantId,
        p_user_id: user.user_id,
        p_roles: roles,
      });
      setNotice(`Roles updated for ${userName(user)}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update roles.");
    } finally {
      setWorkingUserId(null);
    }
  }

  async function updateStatus(user: AdminUser, status: string) {
    setWorkingUserId(user.user_id);
    setError(null);
    setNotice(null);
    try {
      await tenantRpc("set_tenant_user_status", {
        p_tenant_id: tenantId,
        p_user_id: user.user_id,
        p_status: status,
      });
      setNotice(`Access status updated for ${userName(user)}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update user status.");
    } finally {
      setWorkingUserId(null);
    }
  }

  async function updateProviderLink(link: ProviderLink) {
    const nextStatus = link.status === "active" ? "inactive" : "active";
    setWorkingLinkId(link.id);
    setError(null);
    setNotice(null);
    try {
      await tenantRpc("admin_set_provider_link_status", {
        p_provider_id: link.provider_id,
        p_status: nextStatus,
      });
      setNotice(nextStatus === "active"
        ? "Clinician signing access reactivated by practice administrator."
        : "Clinician signing access disabled.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to change clinician signing access.");
    } finally {
      setWorkingLinkId(null);
    }
  }

  if (loading) return <div className="thera-state">Loading users and roles...</div>;

  return (
    <>
      <div className="thera-page-header">
        <div className="thera-eyebrow">ADMINISTRATION · ACCESS CONTROL</div>
        <h1>Users & Roles</h1>
        <p>Review active practice identities, role assignments, and tenant access status. Changes are enforced by server-side administrative RPCs and written to the audit log.</p>
      </div>

      {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
      {notice && <div className="thera-alert" style={{ marginBottom: 12 }}>{notice}</div>}

      <section className="thera-card">
        <div className="thera-table-wrap">
          <table className="thera-table">
            <thead>
              <tr><th>User</th><th>Status</th><th>Roles</th><th>Action</th></tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.user_id}>
                  <td>
                    <strong>{userName(user)}</strong>
                    <div className="thera-table-subtext">{user.email ?? user.user_id}</div>
                  </td>
                  <td>
                    <select
                      className="thera-input"
                      disabled={workingUserId === user.user_id}
                      value={user.status}
                      onChange={(event) => void updateStatus(user, event.target.value)}
                    >
                      {["active","inactive","invited","suspended","terminated"].map((status) => (
                        <option key={status} value={status}>{status.replaceAll("_", " ")}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, minWidth: 360 }}>
                      {ROLE_OPTIONS.map((role) => (
                        <label key={role} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                          <input
                            type="checkbox"
                            checked={(draftRoles[user.user_id] ?? []).includes(role)}
                            onChange={() => toggleRole(user.user_id, role)}
                          />
                          <span>{role.replaceAll("_", " ")}</span>
                        </label>
                      ))}
                    </div>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="thera-action"
                      disabled={workingUserId === user.user_id}
                      onClick={() => void saveRoles(user)}
                    >
                      {workingUserId === user.user_id ? "Saving..." : "Save Roles"}
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={4}><div className="thera-empty">No tenant users found.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="thera-card" style={{ marginTop: 16 }}>
        <div className="thera-card-header">
          <div>
            <h2>Clinician Signing Access</h2>
            <p>Only a practice administrator can disable or reactivate a clinician-to-provider link. Disabling it blocks note signing without removing prior signed records.</p>
          </div>
        </div>
        <div className="thera-table-wrap">
          <table className="thera-table">
            <thead>
              <tr><th>Provider</th><th>Linked Clinician</th><th>Signing Access</th><th>Administrator Action</th></tr>
            </thead>
            <tbody>
              {providerLinks.map((link) => {
                const provider = providers.find((record) => record.id === link.provider_id);
                const user = users.find((record) => record.user_id === link.user_id);
                const providerName = [provider?.first_name, provider?.last_name].filter(Boolean).join(" ") || link.provider_id;
                return (
                  <tr key={link.id}>
                    <td><strong>{providerName}</strong></td>
                    <td>{user ? userName(user) : link.user_id}</td>
                    <td>{link.status === "active" ? "Active" : "Inactive — signing blocked"}</td>
                    <td>
                      <button
                        type="button"
                        className="thera-action"
                        disabled={workingLinkId !== null || (link.status !== "active" && provider?.provider_status !== "active")}
                        onClick={() => void updateProviderLink(link)}
                      >
                        {workingLinkId === link.id ? "Saving..." : link.status === "active" ? "Disable Signing" : "Reactivate Signing"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {providerLinks.length === 0 && (
                <tr><td colSpan={4}><div className="thera-empty">No clinician-to-provider links found for this practice.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="thera-alert" style={{ marginTop: 16 }}>
        Role changes never alter the underlying Auth identity. Suspending or terminating a tenant membership removes practice access while preserving audit history.
      </div>
    </>
  );
}
