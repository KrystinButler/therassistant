/** Section controls and the full editor share the persisted note_text value. */
function sectionRange(note: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped}:[ \t]*\\n`, "im").exec(note);
  if (!match) return null;
  const start = match.index + match[0].length;
  // Stop at template headings or attributed source blocks, preserving adjacent content.
  const headings = ["Subjective", "Objective", "Assessment", "Plan", "Mental Status Examination", "Session focus", "Interventions", "Patient response", "Progress toward goals", "Risk assessment", "Presenting concerns", "History", "Mental status", "Diagnostic assessment", "Risk / safety", "Recommendations", "Chief concern", "Psychosocial context", "Initial plan", "Presenting crisis", "Safety assessment", "Immediate interventions", "Response", "Disposition", "Safety plan", "Service need", "Care coordination", "Resources", "Follow-up", "Symptoms", "Adherence", "Side effects", "Medication plan", "Reason for visit", "Findings", "Intervention"];
  const next = new RegExp(`^(?:(?:${headings.join("|")}):[ \t]*$|PATIENT-REPORTED[^\\n]*$|Patient-reported[^\\n]*$)`, "gim");
  next.lastIndex = start;
  const boundary = next.exec(note);
  return { headingStart: match.index, start, end: boundary?.index ?? note.length };
}

export function readNoteSection(note: string, heading: string): string {
  const range = sectionRange(note, heading);
  return range ? note.slice(range.start, range.end).replace(/\n{1,2}$/, "") : "";
}

export function updateNoteSection(note: string, heading: string, body: string): string {
  const range = sectionRange(note, heading);
  if (range) {
    const prefix = note.slice(0, range.headingStart);
    const suffix = note.slice(range.end);
    return prefix + (body ? `${heading}:\n${body}\n\n` : "") + suffix;
  }
  return body ? `${note}${note && !note.endsWith("\n\n") ? "\n\n" : ""}${heading}:\n${body}\n\n` : note;
}

export function noteDraftFingerprint(value: unknown): string {
  function canonical(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object") return Object.fromEntries(
      Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, canonical(val)]),
    );
    return item;
  }
  return JSON.stringify(canonical(value));
}
