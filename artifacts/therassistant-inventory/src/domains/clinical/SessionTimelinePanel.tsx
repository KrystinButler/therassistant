import { useState } from "react";
import { formatTimelineForNote, type StructuredSelections } from "./fast-charting";
import "./session-timeline.css";
type Props = {
  signed: boolean;
  selections: StructuredSelections;
  onSelectionsChange: (next: StructuredSelections) => void;
  onInsertPhrase: (content: string) => void;
};
/** Keep event tracking next to encounter timing, not below the note's structured findings. */
export function SessionTimelinePanel(props: Props) {
  const [timelineTime, setTimelineTime] = useState(() => new Date().toTimeString().slice(0, 5));
  const [timelineLabel, setTimelineLabel] = useState("");
  const [timelineDetail, setTimelineDetail] = useState("");

  function addTimelineEvent() {
    const label = timelineLabel.trim();
    if (!label || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timelineTime)) return;
    props.onSelectionsChange({
      ...props.selections,
      timelineEvents: [
        ...props.selections.timelineEvents,
        { time: timelineTime, label, detail: timelineDetail.trim() },
      ],
    });
    setTimelineLabel("");
    setTimelineDetail("");
    setTimelineTime(new Date().toTimeString().slice(0, 5));
  }

  function removeTimelineEvent(index: number) {
    props.onSelectionsChange({
      ...props.selections,
      timelineEvents: props.selections.timelineEvents.filter((_, itemIndex) => itemIndex !== index),
    });
  }


  return <details className="encounter-session-timeline" id="encounter-session-timeline">
    <summary className="encounter-timeline-heading">
      <strong>Session Timeline</strong>
      <span>{props.selections.timelineEvents.length ? props.selections.timelineEvents.length + " events recorded" : "Optional · Record session events"}</span>
      <span className="encounter-timeline-chevron" aria-hidden="true">⌄</span>
    </summary>
    <div className="encounter-timeline-body">
      {!props.signed && props.selections.templateType === "kap_medicine_session" && <div className="thera-filter-row" style={{ marginTop: 8, flexWrap: "wrap" }}>
        {["Administration context", "Monitoring observation", "Somatic / emotional response", "Grounding / return"].map((preset) => (
          <button type="button" className="thera-action secondary" key={preset} onClick={() => setTimelineLabel(preset)}>{preset}</button>
        ))}
      </div>}
      {!props.signed && <div className="thera-form-grid" style={{ marginTop: 10 }}>
        <label>Time<input className="thera-input" type="time" value={timelineTime} onChange={(event) => setTimelineTime(event.target.value)} /></label>
        <label>Event<input className="thera-input" value={timelineLabel} onChange={(event) => setTimelineLabel(event.target.value)} placeholder="e.g., Grounding intervention" /></label>
        <label style={{ gridColumn: "1 / -1" }}>Detail<input className="thera-input" value={timelineDetail} onChange={(event) => setTimelineDetail(event.target.value)} placeholder="Optional patient response or clinical context" /></label>
        <button type="button" className="thera-action secondary" disabled={!timelineLabel.trim()} onClick={addTimelineEvent}>+ Add Timeline Event</button>
      </div>}
      {props.selections.timelineEvents.length > 0 ? <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
        {props.selections.timelineEvents.map((event, index) => <div className="thera-alert" key={`${event.time}-${index}`}>
          <strong>{event.time} · {event.label}</strong>
          {event.detail && <div style={{ marginTop: 4 }}>{event.detail}</div>}
          {!props.signed && <button type="button" className="thera-action secondary" style={{ marginTop: 6 }} onClick={() => removeTimelineEvent(index)}>Remove</button>}
        </div>)}
        {!props.signed && <button type="button" className="thera-action secondary" onClick={() => props.onInsertPhrase("\n" + formatTimelineForNote(props.selections.timelineEvents) + "\n")}>Insert Timeline into Note</button>}
      </div> : <div className="thera-table-subtext" style={{ marginTop: 8 }}>No timeline events recorded.</div>}
    </div>
  </details>;
}
