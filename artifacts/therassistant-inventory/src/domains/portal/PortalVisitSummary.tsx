import { CalendarDays, CheckCircle2, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { dateTime } from "../../lib/format";
import { getPreVisitSummary } from "./portal-progress";
import { PORTAL_JOURNAL, portalCheckInPath } from "./routes";
import type { PortalRow } from "./workflow";
import "./patient-portal-redesign.css";

export function PortalVisitSummary({ appointment, checkin, preview = false }: {
  appointment?: PortalRow; checkin?: PortalRow; preview?: boolean;
}) {
  const progress = getPreVisitSummary(checkin);
  return <section className="portal-next-visit" aria-label="Next appointment">
    <div className="portal-next-heading"><span className="thera-eyebrow">YOUR NEXT VISIT</span>
      {preview && <span className="portal-status">Sample · design preview</span>}
      {appointment && !preview && <span className={`portal-status${progress.submitted ? " complete" : ""}`}>{progress.submitted && <CheckCircle2 size={15} />}{progress.label}</span>}
    </div>
    {appointment ? <>
      <h2><CalendarDays size={22} />{dateTime(String(appointment.starts_at ?? ""))}</h2>
      <p>{String(appointment.service_type ?? "Appointment").replaceAll("_", " ")} · {String(appointment.location_type ?? "").replaceAll("_", " ")}</p>
      <div className="portal-visit-footer"><div><strong>{progress.completeSteps} of 5 check-in steps complete</strong><small>{progress.submitted ? "Your answers are ready for provider review." : "Prepare for your visit, then review and submit your answers."}</small></div>
        {preview ? <button type="button" className="thera-action" disabled>{progress.action}<ChevronRight size={16} /></button>
          : <Link className="thera-action" href={portalCheckInPath(appointment.id)}>{progress.action}<ChevronRight size={16} /></Link>}
      </div>
    </> : <><h2>No upcoming appointments</h2><p>You can still write a journal entry or send your practice a message.</p><Link className="thera-action secondary" href={PORTAL_JOURNAL}>Open Journal</Link></>}
  </section>;
}
