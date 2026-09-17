import { tenantSelect, referenceSelect, type Row } from "../../lib/tenant-data-client";
import { buildPatientChartAggregate, type ChartRow } from "./chart";
import type { PatientChart } from "./types";

type DataRow = Row & { id: string };

export async function getPatientChart(patientId: string): Promise<PatientChart> {
  if (!patientId) throw new Error("Patient ID is required.");

  const [
    patients, contacts, policies, eligibility, authorizations, authorizationUnits,
    appointments, encounters, treatmentPlans, treatmentGoals, notes, diagnoses,
    charges, claims, payments, denials, appeals, documents, checkins, journalEntries,
    workItems, providers, payers, plans, balances,
  ] = await Promise.all([
    tenantSelect<DataRow>("clients", { id: `eq.${patientId}`, limit: "1" }),
    tenantSelect<DataRow>("client_contacts", { client_id: `eq.${patientId}`, order: "created_at.asc" }),
    tenantSelect<DataRow>("client_insurance_policies", { client_id: `eq.${patientId}`, order: "created_at.asc" }),
    tenantSelect<DataRow>("eligibility_checks", { client_id: `eq.${patientId}`, order: "service_date.desc,created_at.desc" }),
    tenantSelect<DataRow>("authorizations", { client_id: `eq.${patientId}`, order: "end_date.desc.nullslast,created_at.desc" }),
    tenantSelect<DataRow>("authorization_units", { order: "created_at.asc" }),
    tenantSelect<DataRow>("appointments", { client_id: `eq.${patientId}`, order: "starts_at.desc" }),
    tenantSelect<DataRow>("encounters", { client_id: `eq.${patientId}`, order: "started_at.desc" }),
    tenantSelect<DataRow>("treatment_plans", { client_id: `eq.${patientId}`, order: "effective_date.desc.nullslast,created_at.desc" }),
    tenantSelect<DataRow>("treatment_plan_goals", { order: "created_at.asc" }),
    tenantSelect<DataRow>("clinical_notes", { client_id: `eq.${patientId}`, order: "service_date.desc.nullslast,created_at.desc" }),
    tenantSelect<DataRow>("client_diagnoses", { client_id: `eq.${patientId}`, order: "created_at.desc" }),
    tenantSelect<DataRow>("charge_capture_items", { client_id: `eq.${patientId}`, order: "service_date.desc,created_at.desc" }),
    tenantSelect<DataRow>("professional_claims", { client_id: `eq.${patientId}`, order: "service_date_from.desc,created_at.desc" }),
    tenantSelect<DataRow>("payments", { client_id: `eq.${patientId}`, order: "payment_date.desc,created_at.desc" }),
    tenantSelect<DataRow>("denials", { client_id: `eq.${patientId}`, order: "denial_date.desc,created_at.desc" }),
    tenantSelect<DataRow>("appeals", { order: "created_at.desc" }),
    tenantSelect<DataRow>("documents", { client_id: `eq.${patientId}`, order: "created_at.desc" }),
    tenantSelect<DataRow>("client_checkins", { client_id: `eq.${patientId}`, order: "created_at.desc" }),
    tenantSelect<DataRow>("patient_journal_entries", { client_id: `eq.${patientId}`, order: "entry_date.desc,created_at.desc" }),
    tenantSelect<DataRow>("workqueue_items", { source_object_type: "eq.client", source_object_id: `eq.${patientId}`, order: "created_at.desc" }),
    tenantSelect<DataRow>("providers", { order: "last_name.asc,first_name.asc" }),
    referenceSelect<DataRow>("payers", { order: "name.asc" }),
    referenceSelect<DataRow>("payer_plans", { order: "name.asc" }),
    tenantSelect<DataRow>("client_balance_summaries", { client_id: `eq.${patientId}`, limit: "1" }),
  ]);

  const relevantAuthorizationIds = new Set(authorizations.map((row) => row.id));
  const relevantPlanIds = new Set(treatmentPlans.map((row) => row.id));
  const claimIds = new Set(claims.map((row) => row.id));
  const denialIds = new Set(denials.map((row) => row.id));
  const patientAppeals = appeals.filter((row) =>
    claimIds.has(String(row.claim_id ?? "")) || denialIds.has(String(row.denial_id ?? "")),
  );

  const core = buildPatientChartAggregate({
    patientId,
    patients: patients as ChartRow[],
    contacts: contacts as ChartRow[],
    policies: policies as ChartRow[],
    eligibility: eligibility as ChartRow[],
    authorizations: authorizations as ChartRow[],
    authorizationUnits: authorizationUnits.filter((row) => relevantAuthorizationIds.has(String(row.authorization_id ?? ""))) as ChartRow[],
    appointments: appointments as ChartRow[],
    encounters: encounters as ChartRow[],
    treatmentPlans: treatmentPlans as ChartRow[],
    treatmentGoals: treatmentGoals.filter((row) => relevantPlanIds.has(String(row.treatment_plan_id ?? ""))) as ChartRow[],
    notes: notes as ChartRow[],
    charges: charges as ChartRow[],
    claims: claims as ChartRow[],
    payments: payments as ChartRow[],
    denials: denials as ChartRow[],
    documents: documents as ChartRow[],
    checkins: checkins as ChartRow[],
    journalEntries: journalEntries as ChartRow[],
    workItems: workItems as ChartRow[],
    providers: providers as ChartRow[],
    payers: payers as ChartRow[],
    plans: plans as ChartRow[],
    balances: balances as ChartRow[],
  });

  return {
    ...core,
    diagnoses: diagnoses as ChartRow[],
    appeals: patientAppeals as ChartRow[],
  } as PatientChart;
}
