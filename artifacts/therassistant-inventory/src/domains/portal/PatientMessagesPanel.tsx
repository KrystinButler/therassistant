import { useEffect, useState } from "react";

import { StatusBadge } from "../../components/status-badge";
import { dateTime } from "../../lib/format";
import { getMyPortalMessages, sendMyPortalMessage, type PortalMessageThread } from "./messages-repository";
import "./patient-messages.css";

export function PatientMessagesPanel() {
  const [threads, setThreads] = useState<PortalMessageThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [replyBodies, setReplyBodies] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setThreads(await getMyPortalMessages());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load secure messages.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function startThread() {
    if (!subject.trim() || !body.trim()) return;
    setWorking("new");
    setError(null);
    setNotice(null);
    try {
      await sendMyPortalMessage({ subject: subject.trim(), body: body.trim() });
      setSubject("");
      setBody("");
      setNotice("Your secure message was sent to the practice.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send your message.");
    } finally {
      setWorking(null);
    }
  }

  async function reply(threadId: string) {
    const replyBody = replyBodies[threadId]?.trim() ?? "";
    if (!replyBody) return;
    setWorking(threadId);
    setError(null);
    setNotice(null);
    try {
      await sendMyPortalMessage({ threadId, body: replyBody });
      setReplyBodies((current) => ({ ...current, [threadId]: "" }));
      setNotice("Your reply was sent to the practice.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send your reply.");
    } finally {
      setWorking(null);
    }
  }

  return <section id="messages" className="thera-card thera-span-2">
    <div className="thera-card-header"><div><h2>Secure Messages</h2><p>Send non-urgent messages to your practice and view staff replies.</p></div></div>
    <div className="thera-alert" style={{ marginBottom: 14 }}>Portal messages are not monitored for emergencies. Use emergency services or your practice's emergency instructions for urgent needs.</div>
    {error && <div className="thera-state error" style={{ marginBottom: 12 }}>{error}</div>}
    {notice && <div className="thera-alert" style={{ marginBottom: 12 }}>{notice}</div>}

    <div className="ppm-compose">
      <label className="ppm-field"><span className="thera-field-label">Subject</span><input className="thera-input ppm-input" maxLength={160} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Question for the practice" /></label>
      <label className="ppm-field"><span className="thera-field-label">New message</span><textarea className="thera-input ppm-input ppm-textarea" rows={5} maxLength={4000} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Type your non-urgent message..." /></label>
      <div className="ppm-actions"><button type="button" className="thera-action" disabled={working !== null || !subject.trim() || !body.trim()} onClick={() => void startThread()}>{working === "new" ? "Sending..." : "Send Secure Message"}</button></div>
    </div>

    <div className="thera-card-header"><div><h3 style={{ margin: 0 }}>Conversations</h3><p>{threads.length} conversation{threads.length === 1 ? "" : "s"}</p></div></div>
    {loading ? <div className="thera-state">Loading secure messages...</div> : threads.length ? <div className="thera-stack">{threads.map((thread) => <article className="thera-work-card" key={thread.id}>
      <div className="thera-work-card-top"><div><strong>{thread.subject}</strong><div className="thera-table-subtext">Updated {dateTime(thread.last_message_at)}</div></div><StatusBadge value={thread.status} /></div>
      <div className="thera-stack" style={{ marginTop: 10 }}>{thread.messages.map((message) => <div key={message.id} className="thera-report-list-row" style={{ alignItems: "flex-start" }}><div><strong>{message.sender_type === "patient" ? "You" : "Practice"}</strong><div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{message.body}</div><div className="thera-table-subtext" style={{ marginTop: 4 }}>{dateTime(message.created_at)}</div></div></div>)}</div>
      {thread.status === "open" ? <div className="ppm-reply">
        <label className="ppm-field"><span className="thera-field-label">Reply</span><textarea className="thera-input ppm-input ppm-reply-textarea" rows={3} maxLength={4000} value={replyBodies[thread.id] ?? ""} onChange={(event) => setReplyBodies((current) => ({ ...current, [thread.id]: event.target.value }))} /></label>
        <div className="ppm-actions"><button type="button" className="thera-action secondary" disabled={working !== null || !(replyBodies[thread.id] ?? "").trim()} onClick={() => void reply(thread.id)}>{working === thread.id ? "Sending..." : "Send Reply"}</button></div>
      </div> : <p className="thera-muted" style={{ marginBottom: 0 }}>This conversation is closed. Start a new message if you need additional help.</p>}
    </article>)}</div> : <div className="thera-empty">No secure messages yet.</div>}
  </section>;
}
