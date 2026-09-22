import type { Row } from "../../lib/tenant-data-client";

export type OutcomeInstrument = "phq9" | "gad7";

export type OutcomeScoreDraft = {
  instrumentCode: OutcomeInstrument;
  administeredDate: string;
  totalScore: number;
  notes?: string;
};

export type OutcomeTrend = {
  instrumentCode: OutcomeInstrument;
  label: string;
  count: number;
  earliestDate: string;
  latestDate: string;
  earliestScore: number;
  latestScore: number;
  change: number;
  direction: "decreased" | "increased" | "unchanged";
};

const limits: Record<OutcomeInstrument, number> = {
  phq9: 27,
  gad7: 21,
};

export function instrumentLabel(code: OutcomeInstrument) {
  return code === "phq9" ? "PHQ-9" : "GAD-7";
}

export function validateOutcomeScore(input: OutcomeScoreDraft) {
  if (!input.administeredDate) throw new Error("Assessment date is required.");
  if (!Number.isInteger(input.totalScore)) throw new Error("Outcome score must be a whole number.");
  const max = limits[input.instrumentCode];
  if (input.totalScore < 0 || input.totalScore > max) {
    throw new Error(instrumentLabel(input.instrumentCode) + " score must be between 0 and " + max + ".");
  }
}

export function buildOutcomeScoreValues(input: OutcomeScoreDraft): Row {
  validateOutcomeScore(input);
  return {
    instrument_code: input.instrumentCode,
    administered_date: input.administeredDate,
    total_score: input.totalScore,
    source: "manual_clinical",
    notes: input.notes?.trim() || null,
  };
}

export function buildOutcomeTrends(rows: Row[]): OutcomeTrend[] {
  const result: OutcomeTrend[] = [];
  for (const instrumentCode of ["phq9", "gad7"] as const) {
    const matching = rows
      .filter((row) => String(row.instrument_code ?? "") === instrumentCode)
      .sort((a, b) => String(a.administered_date ?? "").localeCompare(String(b.administered_date ?? "")));
    if (!matching.length) continue;
    const first = matching[0];
    const last = matching[matching.length - 1];
    const earliestScore = Number(first.total_score ?? 0);
    const latestScore = Number(last.total_score ?? 0);
    const change = latestScore - earliestScore;
    result.push({
      instrumentCode,
      label: instrumentLabel(instrumentCode),
      count: matching.length,
      earliestDate: String(first.administered_date ?? ""),
      latestDate: String(last.administered_date ?? ""),
      earliestScore,
      latestScore,
      change,
      direction: change < 0 ? "decreased" : change > 0 ? "increased" : "unchanged",
    });
  }
  return result;
}

export function describeOutcomeTrend(trend: OutcomeTrend) {
  if (trend.count === 1) {
    return trend.label + ": " + trend.latestScore + " on " + trend.latestDate + " (one recorded score).";
  }
  const magnitude = Math.abs(trend.change);
  const changeText = trend.direction === "unchanged"
    ? "unchanged"
    : trend.direction + " by " + magnitude + " point" + (magnitude === 1 ? "" : "s");
  return trend.label + ": " + trend.earliestScore + " on " + trend.earliestDate +
    " to " + trend.latestScore + " on " + trend.latestDate + " (" + changeText + ").";
}
