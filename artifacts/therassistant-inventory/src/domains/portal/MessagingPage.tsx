import { useEffect, useState } from "react";
import { tenantRpc, getCurrentTenantId, type Row } from "../../lib/tenant-data-client";
import { StaffPortalMessagesPanel } from "./StaffPortalMessagesPanel";
export function MessagingPage() {
  const [clients, setClients] = useState<Row[]>([]);
  const [clientId, setClientId] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { let active = true; void getCurrentTenantId().then(id => tenantRpc<Row[]>("get_portal_message_inbox", { p_tenant_id: id })).then(people => { if (!active) return; setClients(people); setClientId(String(people[0]?.id ?? "")); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, []);
  return <><div className="thera-page-header"><h1>Messaging</h1><p>Secure patient conversations and practice replies.</p></div>{error && <div className="thera-state error">{error}</div>}<label className="thera-field"><span className="thera-field-label">Patient conversations</span><select className="thera-input" value={clientId} onChange={e => setClientId(e.target.value)}><option value="">Select a patient</option>{clients.map(p => <option key={String(p.id)} value={String(p.id)}>{String(p.first_name)} {String(p.last_name)}</option>)}</select></label>{clientId ? <StaffPortalMessagesPanel key={clientId} clientId={clientId} /> : <p>No patient conversations available.</p>}</>;
}
