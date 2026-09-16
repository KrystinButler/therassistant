import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpenText,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CreditCard,
  Eye,
  Heart,
  HeartPulse,
  Home,
  Info,
  LockKeyhole,
  MapPin,
  MessageSquare,
  PencilLine,
  Phone,
  Save,
  Tag,
  Target,
  UserRound,
} from "lucide-react";
import { Link, useRoute } from "wouter";

import { addJournalEntry } from "../journal/repository";
import { getPatientPortalData } from "./repository";
import "./patient-journal.css";

type PortalData = Awaited<ReturnType<typeof getPatientPortalData>>;
type EntryStatus = "draft" | "submitted";
type Visibility = "private" | "shared_with_provider";

const moods = [
  { value: "very_rough", label: "Very rough", face: "☹" },
  { value: "rough", label: "Rough", face: "●" },
  { value: "okay", label: "Okay", face: "•" },
  { value: "better", label: "Better", face: "•" },
  { value: "good", label: "Good", face: "●" },
];

const symptomOptions = ["Anxiety", "Low mood", "Stress", "Sleep issues", "Racing thoughts", "Low energy"];
const prompts = [
  "What's something you're proud of this week?",
  "What has been most challenging lately?",
  "What would you like support with in your next session?",
];

function patientName(row: Record<string, unknown>) {
  const preferred = String(row.preferred_name ?? "").trim();
  return [preferred || row.first_name, row.last_name].filter(Boolean).join(" ") || "Patient";
}

function firstName(row: Record<string, unknown>) {
  return String(row.preferred_name ?? row.first_name ?? "Patient");
}

function providerName(row: Record<string, unknown> | null) {
  if (!row) return "Your care team";
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ");
  const credentials = String(row.credentials ?? "").trim();
  return [name || "Your provider", credentials].filter(Boolean).join(", ");
}

function formatDate(value: unknown, options?: Intl.DateTimeFormatOptions) {
  const date = new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, options ?? { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(value: unknown) {
  const date = new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function tagsFrom(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function entryTitle(text: unknown) {
  const clean = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!clean) return "Journal entry";
  const sentence = clean.split(/[.!?]/)[0] || clean;
  return sentence.length > 54 ? `${sentence.slice(0, 51)}...` : sentence;
}

export function PatientJournalPage() {
  const [, params] = useRoute<{ clientId: string }>("/patient-portal/:clientId/journal");
  const clientId = params?.clientId ?? "";
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<EntryStatus | null>(null);
  const [entryText, setEntryText] = useState("");
  const [mood, setMood] = useState("");
  const [goalId, setGoalId] = useState("");
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<Visibility>("shared_with_provider");
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    if (!clientId) return;
    setLoading(true);
    try {
      setData(await getPatientPortalData(clientId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load your journal.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [clientId]);

  const activeGoals = useMemo(
    () => (data?.treatmentGoals ?? []).filter((goal) => String(goal.status ?? "") !== "completed"),
    [data],
  );

  async function saveEntry(entryStatus: EntryStatus) {
    if (!entryText.trim()) {
      setError("Write something before saving your journal entry.");
      return;
    }
    setSaving(entryStatus);
    setError(null);
    setNotice(null);
    try {
      await addJournalEntry(clientId, {
        entryText,
        mood,
        visibility,
        tags: symptoms,
        relatedTreatmentGoalId: goalId || undefined,
        entryStatus,
      });
      setEntryText("");
      setMood("");
      setGoalId("");
      setSymptoms([]);
      setNotice(entryStatus === "draft" ? "Draft saved." : "Journal entry saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save your journal entry.");
    } finally {
      setSaving(null);
    }
  }

  function toggleSymptom(symptom: string) {
    setSymptoms((current) => current.includes(symptom) ? current.filter((item) => item !== symptom) : [...current, symptom]);
  }

  if (loading) return <div className="pj-loading">Loading your journal...</div>;
  if (!data) return <div className="pj-loading pj-error">{error ?? "Your journal is unavailable."}</div>;

  const appointment = data.upcomingAppointments[0];
  const provider = data.provider;
  const recentEntries = showAll ? data.journalEntries : data.journalEntries.slice(0, 3);
  const patientDisplayName = patientName(data.patient);

  return (
    <div className="pj-app">
      <header className="pj-topbar">
        <Link href={`/patient-portal/${clientId}`} className="pj-brand" aria-label="Therassistant patient portal home">
          <span className="pj-logo-mark" aria-hidden="true"><span>▲</span><span>▲</span><span>▲</span></span>
          <span><strong>THERASSISTANT EHR</strong><small>BEHAVIORAL HEALTH. A BRIGHTER TOMORROW.</small></span>
        </Link>
        <div className="pj-topbar-right">
          <span className="pj-care-message">Care today. A healthier tomorrow.</span>
          <span className="pj-avatar">{firstName(data.patient).slice(0, 1).toUpperCase()}</span>
          <span className="pj-user"><strong>{patientDisplayName}</strong><small>Patient Portal</small></span>
        </div>
      </header>

      <div className="pj-layout">
        <aside className="pj-sidebar">
          <div className="pj-welcome"><small>Welcome back,</small><strong>{firstName(data.patient)}</strong></div>
          <div className="pj-mountains" aria-hidden="true">⌁⌁⌁</div>
          <p className="pj-progress-copy">Progress happens<br />between sessions, too.</p>
          <nav className="pj-nav" aria-label="Patient portal navigation">
            <Link href={`/patient-portal/${clientId}`}><Home size={17} /> Home</Link>
            <Link href={`/patient-portal/${clientId}`}><CalendarDays size={17} /> Appointments</Link>
            <Link href={`/patient-portal/${clientId}/journal`} className="active"><BookOpenText size={17} /> Journal</Link>
            <Link href={`/patient-portal/${clientId}`}><Heart size={17} /> Check-In</Link>
            <Link href={`/patient-portal/${clientId}`}><CreditCard size={17} /> Billing</Link>
            <Link href={`/patient-portal/${clientId}`}><MessageSquare size={17} /> Messages</Link>
            <Link href={`/patient-portal/${clientId}`}><UserRound size={17} /> Profile</Link>
          </nav>
          <div className="pj-sidebar-quote"><div className="pj-tree-line">▲ ▲ ▲</div><em>Same people.<br />A Healthier You.</em></div>
        </aside>

        <main className="pj-main">
          <div className="pj-breadcrumb"><span>Journal</span><ChevronRight size={13} /><strong>In-Between Session Journal</strong></div>
          <div className="pj-title-row">
            <div><h1>In-Between Session Journal</h1><p>Capture thoughts, symptoms, progress, and questions between visits.</p></div>
            <div className="pj-hand-note">You're doing<br />meaningful work. ♡</div>
          </div>

          {error && <div className="pj-message error">{error}</div>}
          {notice && <div className="pj-message success"><CheckCircle2 size={16} /> {notice}</div>}

          <section className="pj-card pj-entry-card">
            <div className="pj-card-heading">
              <div><PencilLine size={18} /><strong>New Journal Entry</strong></div>
              <button type="button" className="pj-text-button" disabled={saving !== null} onClick={() => void saveEntry("draft")}>
                {saving === "draft" ? "Saving..." : "Save Draft"}
              </button>
            </div>

            <label className="pj-label" htmlFor="journal-entry">What would you like to remember for your next session?</label>
            <textarea
              id="journal-entry"
              className="pj-textarea"
              maxLength={1000}
              value={entryText}
              onChange={(event) => setEntryText(event.target.value)}
              placeholder="Write freely... thoughts, experiences, wins, challenges, or questions..."
            />
            <div className="pj-count">{entryText.length}/1,000</div>

            <div className="pj-form-two">
              <div>
                <div className="pj-label">How have you been feeling?</div>
                <div className="pj-moods">
                  {moods.map((option, index) => (
                    <button
                      type="button"
                      key={option.value}
                      className={`pj-mood mood-${index + 1}${mood === option.value ? " selected" : ""}`}
                      aria-pressed={mood === option.value}
                      onClick={() => setMood(option.value)}
                    >
                      <span>{option.face}</span><small>{option.label}</small>
                    </button>
                  ))}
                </div>
              </div>

              <label className="pj-field"><span><Target size={14} /> Related goal <small>(optional)</small></span>
                <select value={goalId} onChange={(event) => setGoalId(event.target.value)}>
                  <option value="">Select a treatment goal</option>
                  {activeGoals.map((goal) => <option key={goal.id} value={goal.id}>{String(goal.goal_text ?? "Treatment goal")}</option>)}
                </select>
              </label>

              <div className="pj-field"><span><Tag size={14} /> Symptoms <small>(optional)</small></span>
                <div className="pj-symptom-picker">
                  {symptomOptions.map((symptom) => <button type="button" key={symptom} className={symptoms.includes(symptom) ? "selected" : ""} onClick={() => toggleSymptom(symptom)}>{symptom}</button>)}
                </div>
              </div>

              <label className="pj-field"><span><Eye size={14} /> Share with provider</span>
                <select value={visibility} onChange={(event) => setVisibility(event.target.value as Visibility)}>
                  <option value="shared_with_provider">Share with my provider (recommended)</option>
                  <option value="private">Save privately</option>
                </select>
              </label>
            </div>

            <div className="pj-info"><Info size={16} /><span>Your journal entries are reviewed by your provider before they become part of your clinical record.</span></div>
            <div className="pj-entry-actions">
              <button type="button" className="pj-primary-button" disabled={saving !== null || !entryText.trim()} onClick={() => void saveEntry("submitted")}>
                <Save size={16} /> {saving === "submitted" ? "Saving..." : "Save Entry"}
              </button>
            </div>
          </section>

          <section className="pj-card pj-recent-card">
            <div className="pj-card-heading"><div><BookOpenText size={18} /><strong>Recent Entries</strong></div>{data.journalEntries.length > 3 && <button type="button" className="pj-text-button" onClick={() => setShowAll((value) => !value)}>{showAll ? "Show Less" : "View All Entries"} <ChevronRight size={13} /></button>}</div>
            {recentEntries.length ? (
              <div className="pj-entry-list">
                {recentEntries.map((entry) => {
                  const tags = tagsFrom(entry.tags);
                  const shared = String(entry.visibility ?? "shared_with_provider") === "shared_with_provider";
                  return <article key={entry.id} className="pj-entry-row">
                    <div className="pj-entry-date"><strong>{formatDate(entry.entry_date ?? entry.created_at, { month: "short", day: "numeric" })}</strong><small>{formatDate(entry.entry_date ?? entry.created_at, { year: "numeric" })}</small></div>
                    <div className="pj-entry-body"><strong>{entryTitle(entry.entry_text)}</strong><p>{String(entry.entry_text ?? "")}</p>{tags.length > 0 && <div className="pj-tags">{tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}</div>
                    <div className={`pj-privacy ${shared ? "shared" : "private"}`}>{shared ? <><Eye size={13} /> Shared with provider</> : <><LockKeyhole size={13} /> Saved privately</>}</div>
                  </article>;
                })}
              </div>
            ) : <div className="pj-empty">No journal entries yet. Your first reflection will appear here.</div>}
          </section>
        </main>

        <aside className="pj-rightbar">
          <section className="pj-side-card">
            <h2><CalendarDays size={17} /> Upcoming Appointment</h2>
            {appointment ? <>
              <div className="pj-side-detail"><CalendarDays size={15} /><div><strong>{formatDate(appointment.starts_at, { weekday: "short", month: "short", day: "numeric" })}</strong><small>{formatTime(appointment.starts_at)}</small></div></div>
              <div className="pj-side-detail"><MapPin size={15} /><div><strong>{String(appointment.service_type ?? "Appointment")}</strong><small>{String(appointment.location_type ?? "Office").replaceAll("_", " ")}</small></div></div>
              <Link href={`/patient-portal/${clientId}`} className="pj-outline-button">View Appointment <ChevronRight size={14} /></Link>
            </> : <p className="pj-muted">No upcoming appointment is scheduled.</p>}
          </section>

          <section className="pj-side-card">
            <h2><UserRound size={17} /> Your Provider</h2>
            <div className="pj-provider"><div className="pj-provider-avatar">{String(provider?.first_name ?? "C").slice(0, 1)}{String(provider?.last_name ?? "T").slice(0, 1)}</div><div><strong>{providerName(provider)}</strong><small>{provider ? "Your behavioral health provider" : "Your care team"}</small></div></div>
            <p className="pj-provider-bio">Your provider can review entries you choose to share and use them to support your next session.</p>
            <Link href={`/patient-portal/${clientId}`} className="pj-outline-button">View Full Profile <ChevronRight size={14} /></Link>
          </section>

          <section className="pj-side-card pj-prompts">
            <h2><HeartPulse size={17} /> Reflection Prompts</h2>
            {prompts.map((prompt) => <button type="button" key={prompt} onClick={() => setEntryText((current) => current ? `${current}\n\n${prompt}\n` : `${prompt}\n`)}><span>{prompt}</span><ChevronRight size={14} /></button>)}
          </section>

          <section className="pj-emergency">
            <AlertTriangle size={21} />
            <div><strong>If this is an emergency</strong><span>Call 911 or go to the nearest emergency room.</span></div>
            <a href="tel:911" aria-label="Call 911"><Phone size={18} /></a>
          </section>
        </aside>
      </div>
    </div>
  );
}
