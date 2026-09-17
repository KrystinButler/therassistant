import {
  bigint,
  date,
  integer,
  pgTable,
  text,
  time,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { tenantsTable } from "./tenancy";
import { clientsTable } from "./clients";
import { providersTable } from "./providers";
import { payersTable } from "./payers";
import {
  appointmentLocationTypeEnum,
  appointmentStatusEnum,
  chargeStatusEnum,
  clinicalNoteStatusEnum,
  clinicalNoteTypeEnum,
  treatmentPlanStatusEnum,
} from "./enums";

export const appointmentsTable = pgTable("appointments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  providerId: uuid("provider_id").references(() => providersTable.id),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  appointmentStatus: appointmentStatusEnum("appointment_status").notNull().default("scheduled"),
  locationType: appointmentLocationTypeEnum("location_type").notNull().default("telehealth"),
  serviceType: text("service_type"),
  cptCode: text("cpt_code"),
  notes: text("notes"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const treatmentPlansTable = pgTable("treatment_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  providerId: uuid("provider_id").references(() => providersTable.id),
  status: treatmentPlanStatusEnum("status").notNull().default("draft"),
  effectiveDate: date("effective_date", { mode: "string" }),
  reviewDueDate: date("review_due_date", { mode: "string" }),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  planText: text("plan_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  problemStatement: text("problem_statement"),
  interventions: text("interventions"),
});

export const treatmentPlanGoalsTable = pgTable("treatment_plan_goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  treatmentPlanId: uuid("treatment_plan_id").notNull().references(() => treatmentPlansTable.id, { onDelete: "cascade" }),
  goalText: text("goal_text").notNull(),
  objectiveText: text("objective_text"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clinicalNotesTable = pgTable("clinical_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  appointmentId: uuid("appointment_id").references(() => appointmentsTable.id),
  providerId: uuid("provider_id").references(() => providersTable.id),
  treatmentPlanId: uuid("treatment_plan_id").references(() => treatmentPlansTable.id),
  noteType: clinicalNoteTypeEnum("note_type").notNull().default("psychotherapy"),
  noteStatus: clinicalNoteStatusEnum("note_status").notNull().default("draft"),
  serviceDate: date("service_date", { mode: "string" }),
  startTime: time("start_time"),
  endTime: time("end_time"),
  durationMinutes: integer("duration_minutes"),
  cptCode: text("cpt_code"),
  diagnosisCode: text("diagnosis_code"),
  goalAddressed: text("goal_addressed"),
  noteText: text("note_text"),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  encounterId: uuid("encounter_id"),
});

export const clinicalNoteSignaturesTable = pgTable("clinical_note_signatures", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  clinicalNoteId: uuid("clinical_note_id").notNull().references(() => clinicalNotesTable.id, { onDelete: "cascade" }),
  signerId: uuid("signer_id"),
  signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
  signatureText: text("signature_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  providerId: uuid("provider_id").references(() => providersTable.id),
});

export const chargeCaptureItemsTable = pgTable("charge_capture_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  appointmentId: uuid("appointment_id").references(() => appointmentsTable.id),
  clinicalNoteId: uuid("clinical_note_id").references(() => clinicalNotesTable.id),
  providerId: uuid("provider_id").references(() => providersTable.id),
  payerId: uuid("payer_id").references(() => payersTable.id),
  serviceDate: date("service_date", { mode: "string" }).notNull(),
  cptCode: text("cpt_code").notNull(),
  modifier1: text("modifier1"),
  modifier2: text("modifier2"),
  diagnosisCode: text("diagnosis_code"),
  placeOfService: text("place_of_service"),
  chargeAmountCents: bigint("charge_amount_cents", { mode: "number" }).notNull().default(0),
  chargeStatus: chargeStatusEnum("charge_status").notNull().default("captured"),
  blockReason: text("block_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  encounterId: uuid("encounter_id"),
});

export type Appointment = typeof appointmentsTable.$inferSelect;
export type NewAppointment = typeof appointmentsTable.$inferInsert;
export type TreatmentPlan = typeof treatmentPlansTable.$inferSelect;
export type NewTreatmentPlan = typeof treatmentPlansTable.$inferInsert;
export type TreatmentPlanGoal = typeof treatmentPlanGoalsTable.$inferSelect;
export type NewTreatmentPlanGoal = typeof treatmentPlanGoalsTable.$inferInsert;
export type ClinicalNote = typeof clinicalNotesTable.$inferSelect;
export type NewClinicalNote = typeof clinicalNotesTable.$inferInsert;
export type ClinicalNoteSignature = typeof clinicalNoteSignaturesTable.$inferSelect;
export type NewClinicalNoteSignature = typeof clinicalNoteSignaturesTable.$inferInsert;
export type ChargeCaptureItem = typeof chargeCaptureItemsTable.$inferSelect;
export type NewChargeCaptureItem = typeof chargeCaptureItemsTable.$inferInsert;
