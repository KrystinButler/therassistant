export type SettingsMode = "demo" | "authenticated";

export type SystemRole =
  | "platform_admin"
  | "practice_admin"
  | "billing_company_admin"
  | "billing_manager"
  | "biller"
  | "clinician"
  | "front_desk"
  | "credentialing_specialist"
  | "read_only"
  | "client";

export type UserStatus = "active" | "inactive" | "invited" | "suspended" | "terminated";

export type PracticeSettings = {
  contact_email?: string | null;
  contact_phone?: string | null;
  website?: string | null;
};

export type PatientRecordsSettings = {
  enable_preferred_name?: boolean;
  enable_emergency_contacts?: boolean;
  enable_patient_journal?: boolean;
  enable_treatment_plans?: boolean;
  enable_document_uploads?: boolean;
};

export type ClientPortalSettings = {
  enabled?: boolean;
  balance_limit_cents?: number | null;
  allow_online_payments?: boolean;
  allow_journal?: boolean;
  allow_documents?: boolean;
  allow_appointments?: boolean;
};

export type PracticeBillingSettings = {
  default_place_of_service?: string | null;
  default_claim_frequency_code?: string | null;
  auto_create_charge_after_signed_note?: boolean;
  require_billing_readiness_before_charge?: boolean;
  statement_from_name?: string | null;
};

export type PatientBillingSettings = {
  statements_enabled?: boolean;
  minimum_statement_balance_cents?: number;
  statement_due_days?: number;
  show_insurance_pending_balance?: boolean;
  allow_payment_plans?: boolean;
};

export type BrandingSettings = {
  logo_path?: string | null;
};

export type SettingsNamespace =
  | "practice"
  | "patient_records"
  | "client_portal"
  | "practice_billing"
  | "patient_billing"
  | "branding";

export type TenantSettings = Record<string, unknown> & {
  practice?: PracticeSettings;
  patient_records?: PatientRecordsSettings;
  client_portal?: ClientPortalSettings;
  practice_billing?: PracticeBillingSettings;
  patient_billing?: PatientBillingSettings;
  branding?: BrandingSettings;
};

export type PracticeIdentity = {
  id: string;
  name: string;
  timezone: string;
  contact_email: string | null;
  contact_phone: string | null;
  website: string | null;
};

export type PracticeUpdate = {
  name: string;
  timezone: string;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
};

export type PracticeLocation = {
  id: string;
  name: string;
  status: "active" | "inactive";
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  phone: string | null;
  email: string | null;
  place_of_service_code: string | null;
  is_billing_location: boolean;
  is_primary: boolean;
};

export type PracticeLocationInput = Omit<PracticeLocation, "id"> & { id?: string };

export type ServiceCode = {
  id: string;
  code: string;
  description: string;
  default_fee_cents: number;
  default_units: number;
  default_duration_minutes: number | null;
  default_place_of_service: string | null;
  active: boolean;
  sort_order: number;
};

export type ServiceCodeInput = Omit<ServiceCode, "id"> & { id?: string };

export type DiagnosisCode = {
  id: string;
  code: string;
  description: string;
  active: boolean;
  favorite: boolean;
  sort_order: number;
};

export type DiagnosisCodeInput = Omit<DiagnosisCode, "id"> & { id?: string };

export type Intervention = {
  id: string;
  name: string;
  category: string | null;
  active: boolean;
  sort_order: number;
};

export type InterventionInput = Omit<Intervention, "id"> & { id?: string };

export type StaffMember = {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  email: string | null;
  status: UserStatus;
  role: SystemRole;
  invitedAt: string | null;
  joinedAt: string | null;
};

export type ActivitySource = "audit" | "phi";

export type ActivityRow = {
  id: string;
  timestamp: string;
  source: ActivitySource;
  userId: string | null;
  userName: string;
  action: string;
  targetType: string;
  targetId: string | null;
  clientId: string | null;
  summary: string;
};

export type ActivityFilters = {
  startDate?: string;
  endDate?: string;
  userId?: string;
  action?: string;
  targetType?: string;
  search?: string;
};

export type PaymentProcessingState = "not_connected" | "connected" | "action_required";

export type PaymentProcessingStatus = {
  state: PaymentProcessingState;
  provider: string | null;
  accountLabel: string | null;
  message: string | null;
};

export type SettingsSnapshot = {
  mode: SettingsMode;
  practice: PracticeIdentity;
  settings: TenantSettings;
  locations: PracticeLocation[];
  serviceCodes: ServiceCode[];
  diagnosisCodes: DiagnosisCode[];
  interventions: Intervention[];
  staff: StaffMember[];
  paymentProcessing: PaymentProcessingStatus;
};
