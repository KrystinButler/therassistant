import type { ChartRow, PatientReadinessSummary } from "./chart";

export type PatientChartRow = ChartRow;

export type PatientChart = {
  patient: PatientChartRow;
  contacts: PatientChartRow[];
  insurancePolicies: PatientChartRow[];
  eligibilityHistory: PatientChartRow[];
  authorizations: PatientChartRow[];
  appointments: PatientChartRow[];
  encounters: PatientChartRow[];
  treatmentPlans: Array<PatientChartRow & { goals: PatientChartRow[] }>;
  clinicalNotes: PatientChartRow[];
  charges: PatientChartRow[];
  claims: PatientChartRow[];
  payments: PatientChartRow[];
  denials: PatientChartRow[];
  documents: PatientChartRow[];
  checkins: PatientChartRow[];
  workItems: PatientChartRow[];
  openBalanceCents: number;
  summary: PatientReadinessSummary;
};
