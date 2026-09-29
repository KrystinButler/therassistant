import { useEffect, useState } from "react";

import { StatusBadge } from "../../components/status-badge";
import { dateTime } from "../../lib/format";
import { closeClientPortalMessageThread, getClientPortalMessages, replyClientPortalMessage, type PortalMessageThread } from "./messages-repository";

export function StaffPortalMessagesPanel({ clientId }: { clientId: string }) {
  const [threads, setThreads] = useState<PortalMessageThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [replyBodies, setReplyBodies] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setThreads(await getClientPortalMessages(clientId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load portal messages.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [clientId]);

  async function reply(threadId: string) {
    const body = replyBodies[threadId]?.trim() ?? "";
    if (!body) return;
    setWorking(`reply-${threadId}`);
    setError(null);
    try {
      await replyClientPortalMessage(threadId, body);
      setReplyBodies((current) => ({ ...current, [threadId]: "" }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send staff reply.");
    } finally {
      setWorking(null);
    }
  }

  async function closeThread(threadId: string) {
    setWorking(`close-${threadId}`);
    setError(null);
    try {
      await closeClientPortalMessageThread(threadId, "Conversation closed from Patient Chart Engagement.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to close conversation.");
    } finally {
      setWorking(null);
    }
  }

  return <section className="thera-card thera-span-2">
    <div className="thera-card-header"><div><h2>Patient Portal Messages</h2><p>Secure patient-authored conversations. Replies are written back to the same audited thread.</p></div></div>
    {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
    {loading ? <div className="thera-state">Loading portal messages...</div> : threads.length ? <div className="thera-stack">{threads.map((thread) => <article className="thera-work-card" key={thread.id}>
      <div className="thera-work-card-top"><div><strong>{thread.subject}</strong><div className="thera-table-subtext">Updated {dateTime(thread.last_message_at)}</div></div><StatusBadge value={thread.status} /></div>
      <div className="thera-stack" style={{ marginTop: 10 }}>{thread.messages.map((message) => <div className="thera-report-list-row" style={{ alignItems: "flex-start" }} key={message.id}><div><strong>{message.sender_type === "patient" ? "Patient" : "Staff"}</strong><div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{message.body}</div><div className="thera-table-subtext" style={{ marginTop: 4 }}>{dateTime(message.created_at)}</div></div></div>)}</div>
      {thread.status === "open" && <div className="thera-form-grid" style={{ marginTop: 12 }}>
        <label className="thera-field thera-span-2"><span className="thera-field-label">Staff reply</span><textarea className="thera-input" rows={3} maxLength={4000} value={replyBodies[thread.id] ?? ""} onChange={(event) => setReplyBodies((current) => ({ ...current, [thread.id]: event.target.value }))} /></label>
        <div className="thera-filter-row"><button type="button" className="thera-action" disabled={working !== null || !(replyBodies[thread.id] ?? "").trim()} onClick={() => void reply(thread.id)}>{working === `reply-${thread.id}` ? "Sending..." : "Reply to Patient"}</button><button type="button" className="thera-action secondary" disabled={working !== null} onClick={() => void closeThread(thread.id)}>{working === `close-${thread.id}` ? "Closing..." : "Close Conversation"}</button></div>
      </div>}
    </article>)}</div> : <div className="thera-empty">No patient portal messages.</div>}
  </section>;
}
