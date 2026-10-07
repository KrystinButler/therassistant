import { useEffect, useState } from "react";
import { tenantUpdate } from "../../lib/tenant-data-client";
import { safeTelehealthUrl } from "./telehealth-link";
export function TelehealthVisit({ appointment, editable = false }: { appointment: Record<string, any> | null | undefined; editable?: boolean }) {
  const [url, setUrl] = useState(String(appointment?.telehealth_url ?? ""));
  const [savedUrl, setSavedUrl] = useState(url);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { const next = String(appointment?.telehealth_url ?? ""); setUrl(next); setSavedUrl(next); }, [appointment?.id, appointment?.telehealth_url]);
  if (!appointment || appointment.location_type !== "telehealth") return null;
  const joinUrl = safeTelehealthUrl(savedUrl);
  async function save() { const valid = safeTelehealthUrl(url); if (url.trim() && !valid) { setMessage("Enter a valid HTTPS video visit URL."); return; } setSaving(true); try { await tenantUpdate("appointments", String(appointment!.id), { telehealth_url: valid }); setSavedUrl(valid ?? ""); setMessage("Video link saved and available in the patient’s portal."); } catch (e) { setMessage(e instanceof Error ? e.message : "Unable to save video link."); } finally { setSaving(false); } }
  return <section className="thera-card" aria-label="Telehealth visit"><h3>Telehealth visit</h3>{joinUrl ? <a href={joinUrl} className="thera-action" target="_blank" rel="noopener noreferrer">Join Video Visit</a> : <p>{editable ? "Add the video link for this appointment." : "Your practice has not added a video link yet. Contact the practice before your visit."}</p>}{editable && <div className="thera-form-grid"><label className="thera-field"><span className="thera-field-label">Appointment video URL</span><input type="url" className="thera-input" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" /></label><button type="button" className="thera-action secondary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save Video Link"}</button></div>}{message && <p role="status">{message}</p>}</section>;
}
