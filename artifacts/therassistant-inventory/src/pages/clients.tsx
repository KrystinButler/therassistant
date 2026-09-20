import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { StatusBadge } from "../components/status-badge";
import { WorkDrawer } from "../components/work-drawer";
import { createPatientWithOptionalPortal } from "../domains/patients/create-patient-with-portal";
import { validatePatientIntakeEmergencyContact } from "../domains/patients/workflow";
import { invitePatientPortal } from "../domains/portal/staff-portal-access";
import { dateTime, money, shortDate } from "../lib/format";
import { getCurrentTenantId, referenceSelect, tenantInsert, tenantRpc, tenantSelect, tenantUpdate, type Row } from "../lib/tenant-data-client";
import { useApi } from "../lib/therassistant-api";

type ClientRow = {
  id: string;
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  dateOfBirth?: string | null;
  email?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  sex?: Sex;
  billingType?: BillingType;
  metadata?: Row;
  clientStatus: string;
  registrationStatus: string;
  billingReadinessStatus: string;
  payerName?: string | null;
  planName?: string | null;
  nextAppointment?: string | null;
  openBalanceCents?: number;
};

type PayerRow = Row & { id: string; name: string };
type PayerPlanRow = Row & { id: string; payer_id: string; name: string; plan_type?: string | null };
type CreatedRow = Row & { id: string };
type Sex = "" | "M" | "F";
type CoverageKey = "primary" | "secondary";
type BillingType = "insurance" | "self_pay";

type InsuranceForm = {
  id?: string;
  status?: string;
  payer_id: string;
  plan_name: string;
  product: string;
  member_id: string;
  group_number: string;
  subscriber_first_name: string;
  subscriber_last_name: string;
  subscriber_dob: string;
  subscriber_sex: Sex;
  subscriber_address_line1: string;
  subscriber_address_line2: string;
  subscriber_city: string;
  subscriber_state: string;
  subscriber_postal_code: string;
  subscriber_phone: string;
  relationship_to_subscriber: string;
};

type FormState = {
  id?: string;
  first_name: string;
  last_name: string;
  preferred_name: string;
  date_of_birth: string;
  sex: Sex;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  email: string;
  phone: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_relationship: string;
  client_status: string;
  registration_status: string;
  billing_type: BillingType;
  metadata: Row;
  primary: InsuranceForm;
  secondary: InsuranceForm;
};

const RELATIONSHIPS = [
  ["self", "Self"],
  ["spouse", "Spouse"],
  ["child", "Child"],
  ["parent", "Parent"],
  ["other", "Other"],
] as const;

function blankInsurance(primary = false): InsuranceForm {
  return {
    payer_id: "",
    plan_name: "",
    product: "",
    member_id: "",
    group_number: "",
    subscriber_first_name: "",
    subscriber_last_name: "",
    subscriber_dob: "",
    subscriber_sex: "",
    subscriber_address_line1: "",
    subscriber_address_line2: "",
    subscriber_city: "",
    subscriber_state: "",
    subscriber_postal_code: "",
    subscriber_phone: "",
    relationship_to_subscriber: primary ? "self" : "",
  };
}

function objectRow(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function coverageFromRow(row: Row | undefined, plans: PayerPlanRow[], primary: boolean): InsuranceForm {
  if (!row) return blankInsurance(primary);
  const meta = objectRow(row.metadata);
  const subscriber = objectRow(meta.subscriber);
  const plan = plans.find((item) => item.id === row.payer_plan_id);
  return {
    id: String(row.id ?? "") || undefined,
    status: String(row.status ?? "pending_verification"),
    payer_id: String(row.payer_id ?? ""),
    plan_name: String(meta.plan_name ?? plan?.name ?? ""),
    product: String(meta.product ?? ""),
    member_id: String(row.member_id ?? ""),
    group_number: String(row.group_number ?? ""),
    subscriber_first_name: String(subscriber.first_name ?? ""),
    subscriber_last_name: String(subscriber.last_name ?? ""),
    subscriber_dob: String(subscriber.dob ?? row.subscriber_dob ?? "").slice(0, 10),
    subscriber_sex: ["M", "F"].includes(String(subscriber.sex ?? "")) ? String(subscriber.sex) as Sex : "",
    subscriber_address_line1: String(subscriber.address_line1 ?? ""),
    subscriber_address_line2: String(subscriber.address_line2 ?? ""),
    subscriber_city: String(subscriber.city ?? ""),
    subscriber_state: String(subscriber.state ?? ""),
    subscriber_postal_code: String(subscriber.postal_code ?? ""),
    subscriber_phone: String(subscriber.phone ?? ""),
    relationship_to_subscriber: String(row.relationship_to_subscriber ?? (primary ? "self" : "")),
  };
}

function blankPatient(): FormState {
  return {
    first_name: "",
    last_name: "",
    preferred_name: "",
    date_of_birth: "",
    sex: "",
    address_line1: "",
    address_line2: "",
    city: "",
    state: "",
    postal_code: "",
    email: "",
    phone: "",
    emergency_contact_name: "",
    emergency_contact_phone: "",
    emergency_contact_relationship: "",
    client_status: "active",
    registration_status: "complete",
    billing_type: "insurance",
    metadata: {},
    primary: blankInsurance(true),
    secondary: blankInsurance(false),
  };
}

function cloneForm(form: FormState): FormState {
  return {
    ...form,
    primary: { ...form.primary },
    secondary: { ...form.secondary },
  };
}

function hasSecondaryData(coverage: InsuranceForm) {
  return Object.values(coverage).some((value) => value.trim().length > 0);
}

function validPostalCode(value: string) {
  return /^[0-9]{5}(-?[0-9]{4})?$/.test(value.trim());
}

function patientAddressComplete(form: FormState) {
  return Boolean(
    form.address_line1.trim() &&
    form.city.trim() &&
    form.state.trim().length === 2 &&
    validPostalCode(form.postal_code)
  );
}

function subscriberComplete(coverage: InsuranceForm) {
  if (coverage.relationship_to_subscriber === "self") return true;
  return Boolean(
    coverage.relationship_to_subscriber &&
    coverage.subscriber_first_name.trim() &&
    coverage.subscriber_last_name.trim() &&
    coverage.subscriber_dob &&
    coverage.subscriber_sex &&
    coverage.subscriber_address_line1.trim() &&
    coverage.subscriber_city.trim() &&
    coverage.subscriber_state.trim().length === 2 &&
    validPostalCode(coverage.subscriber_postal_code)
  );
}

function insuranceCoverageComplete(coverage: InsuranceForm) {
  return Boolean(
    coverage.payer_id &&
    coverage.member_id.trim() &&
    coverage.relationship_to_subscriber &&
    subscriberComplete(coverage)
  );
}

function requiredAddFieldsComplete(form: FormState) {
  const demographicsComplete = Boolean(
    form.first_name.trim() &&
    form.last_name.trim() &&
    form.date_of_birth &&
    form.sex &&
    patientAddressComplete(form) &&
    form.phone.trim() &&
    form.email.trim()
  );
  if (!demographicsComplete) return false;
  if (form.billing_type === "self_pay") return true;
  return Boolean(
    form.primary.payer_id &&
    form.primary.member_id.trim() &&
    form.primary.relationship_to_subscriber &&
    subscriberComplete(form.primary)
  );
}

function findPlanId(plans: PayerPlanRow[], payerId: string, planName: string) {
  const normalized = planName.trim().toLowerCase();
  if (!payerId || !normalized) return null;
  return plans.find((plan) => plan.payer_id === payerId && plan.name.trim().toLowerCase() === normalized)?.id ?? null;
}

function subscriberValues(form: FormState, coverage: InsuranceForm) {
  const self = coverage.relationship_to_subscriber === "self";
  const firstName = coverage.subscriber_first_name.trim() || (self ? form.first_name.trim() : "");
  const lastName = coverage.subscriber_last_name.trim() || (self ? form.last_name.trim() : "");
  return {
    firstName,
    lastName,
    dob: coverage.subscriber_dob || (self ? form.date_of_birth : ""),
    sex: coverage.subscriber_sex || (self ? form.sex : ""),
    addressLine1: coverage.subscriber_address_line1.trim() || (self ? form.address_line1.trim() : ""),
    addressLine2: coverage.subscriber_address_line2.trim() || (self ? form.address_line2.trim() : ""),
    city: coverage.subscriber_city.trim() || (self ? form.city.trim() : ""),
    state: (coverage.subscriber_state.trim() || (self ? form.state.trim() : "")).toUpperCase(),
    postalCode: coverage.subscriber_postal_code.trim() || (self ? form.postal_code.trim() : ""),
    phone: coverage.subscriber_phone.trim() || (self ? form.phone.trim() : ""),
  };
}

function coveragePayload(plans: PayerPlanRow[], coverage: InsuranceForm, patient: FormState): Row {
  const subscriber = subscriberValues(patient, coverage);
  return {
    payer_id: coverage.payer_id,
    payer_plan_id: findPlanId(plans, coverage.payer_id, coverage.plan_name),
    member_id: coverage.member_id.trim(),
    group_number: coverage.group_number.trim() || null,
    subscriber_name: [subscriber.firstName, subscriber.lastName].filter(Boolean).join(" ") || null,
    subscriber_dob: subscriber.dob || null,
    relationship_to_subscriber: coverage.relationship_to_subscriber || null,
    metadata: {
      plan_name: coverage.plan_name.trim() || null,
      product: coverage.product.trim() || null,
      subscriber: {
        first_name: subscriber.firstName || null,
        last_name: subscriber.lastName || null,
        sex: subscriber.sex || null,
        dob: subscriber.dob || null,
        address_line1: subscriber.addressLine1 || null,
        address_line2: subscriber.addressLine2 || null,
        city: subscriber.city || null,
        state: subscriber.state || null,
        postal_code: subscriber.postalCode || null,
        address: [subscriber.addressLine1, subscriber.addressLine2, subscriber.city, subscriber.state, subscriber.postalCode].filter(Boolean).join(", ") || null,
        phone: subscriber.phone || null,
      },
    },
  };
}

export function ClientsPage() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [version, setVersion] = useState(0);
  const [form, setForm] = useState<FormState | null>(null);
  const [baseline, setBaseline] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pageNotice, setPageNotice] = useState<{
    kind: "success" | "error";
    message: string;
    patientId: string;
  } | null>(null);
  const [payers, setPayers] = useState<PayerRow[]>([]);
  const [plans, setPlans] = useState<PayerPlanRow[]>([]);
  const [payerLookupError, setPayerLookupError] = useState<string | null>(null);

  const { data, loading, error } = useApi<ClientRow[]>(`/api/clients?search=${encodeURIComponent(search)}&refresh=${version}`);
  const dirty = useMemo(() => Boolean(form && baseline && JSON.stringify(form) !== JSON.stringify(baseline)), [form, baseline]);
  const addRequiredComplete = Boolean(form && !form.id && requiredAddFieldsComplete(form));

  useEffect(() => {
    let active = true;
    Promise.all([
      referenceSelect<PayerRow>("payers", { order: "name.asc" }),
      referenceSelect<PayerPlanRow>("payer_plans", { order: "name.asc" }),
    ]).then(([payerRows, planRows]) => {
      if (!active) return;
      setPayers(payerRows);
      setPlans(planRows);
      setPayerLookupError(null);
    }).catch((err) => {
      if (!active) return;
      setPayerLookupError(err instanceof Error ? err.message : "Unable to load insurance companies.");
    });
    return () => { active = false; };
  }, []);

  function openForm(next: FormState) {
    setForm(next);
    setBaseline(cloneForm(next));
    setFormError(null);
  }

  function closeForm() {
    setForm(null);
    setBaseline(null);
    setFormError(null);
  }

  function updateCoverage(which: CoverageKey, values: Partial<InsuranceForm>) {
    setForm((current) => current ? { ...current, [which]: { ...current[which], ...values } } : current);
  }

  async function save(enrollPortal = false) {
    if (!form) return;
    setFormError(null);

    if (form.id) {
      if (!form.first_name.trim() || !form.last_name.trim() || !form.date_of_birth || !form.sex || !patientAddressComplete(form)) {
        setFormError("Complete the patient's required demographics and structured address.");
        return;
      }
      if (form.billing_type === "insurance" && !insuranceCoverageComplete(form.primary)) {
        setFormError("Complete the primary insurance and subscriber information before saving.");
        return;
      }
      if (
        form.billing_type === "insurance" &&
        hasSecondaryData(form.secondary) &&
        !insuranceCoverageComplete(form.secondary)
      ) {
        setFormError("Complete the secondary insurance and subscriber information before saving.");
        return;
      }

      setSaving(true);
      try {
        await tenantUpdate("clients", form.id, {
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          preferred_name: form.preferred_name || null,
          date_of_birth: form.date_of_birth || null,
          email: form.email || null,
          phone: form.phone || null,
          address_line1: form.address_line1.trim(),
          address_line2: form.address_line2.trim() || null,
          city: form.city.trim(),
          state: form.state.trim().toUpperCase(),
          postal_code: form.postal_code.replace(/[^0-9]/g, ""),
          metadata: {
            ...form.metadata,
            sex: form.sex,
            billing_type: form.billing_type,
          },
          client_status: form.client_status,
          registration_status: form.registration_status,
        });

        if (form.billing_type === "insurance") {
          const primaryPayload = coveragePayload(plans, form.primary, form);
          if (form.primary.id) {
            await tenantUpdate("client_insurance_policies", form.primary.id, primaryPayload);
          } else {
            await tenantInsert("client_insurance_policies", {
              ...primaryPayload,
              client_id: form.id,
              insurance_order: "primary",
              status: "pending_verification",
            });
          }

          if (hasSecondaryData(form.secondary)) {
            const secondaryPayload = coveragePayload(plans, form.secondary, form);
            if (form.secondary.id) {
              await tenantUpdate("client_insurance_policies", form.secondary.id, secondaryPayload);
            } else {
              await tenantInsert("client_insurance_policies", {
                ...secondaryPayload,
                client_id: form.id,
                insurance_order: "secondary",
                status: "pending_verification",
              });
            }
          }
        }

        closeForm();
        setVersion((v) => v + 1);
      } catch (err) {
        setFormError(err instanceof Error ? err.message : "Unable to save patient.");
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!requiredAddFieldsComplete(form)) {
      setFormError("Complete all required patient fields and primary insurance fields when billing insurance.");
      return;
    }
    if (form.billing_type === "insurance" && !subscriberComplete(form.primary)) {
      setFormError("Complete all required primary subscriber fields when the patient is not the subscriber.");
      return;
    }
    if (
      form.billing_type === "insurance" &&
      hasSecondaryData(form.secondary) &&
      (!form.secondary.payer_id ||
        !form.secondary.member_id.trim() ||
        !form.secondary.relationship_to_subscriber ||
        !subscriberComplete(form.secondary))
    ) {
      setFormError("Complete the secondary insurance and subscriber fields when secondary coverage is entered.");
      return;
    }

    let emergencyContact: Row | null;
    try {
      emergencyContact = validatePatientIntakeEmergencyContact({
        name: form.emergency_contact_name,
        phone: form.emergency_contact_phone,
        relationship: form.emergency_contact_relationship,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Emergency contact information is incomplete.");
      return;
    }

    setSaving(true);
    try {
      const tenantId = await getCurrentTenantId();
      const result = await createPatientWithOptionalPortal({
        enrollPortal,
        createPatient: () => tenantRpc<CreatedRow>("create_patient_intake", {
          p_tenant_id: tenantId,
          p_patient: {
            first_name: form.first_name.trim(),
            last_name: form.last_name.trim(),
            preferred_name: form.preferred_name.trim() || null,
            date_of_birth: form.date_of_birth,
            sex: form.sex,
            email: form.email.trim(),
            phone: form.phone.trim(),
            address_line1: form.address_line1.trim(),
            address_line2: form.address_line2.trim() || null,
            city: form.city.trim(),
            state: form.state.trim().toUpperCase(),
            postal_code: form.postal_code.trim(),
            client_status: form.client_status,
            registration_status: form.registration_status,
            billing_type: form.billing_type,
          },
          p_emergency_contact: emergencyContact,
          p_primary_insurance: form.billing_type === "insurance" ? coveragePayload(plans, form.primary, form) : null,
          p_secondary_insurance: form.billing_type === "insurance" && hasSecondaryData(form.secondary) ? coveragePayload(plans, form.secondary, form) : null,
          p_portal_enrolled: false,
        }),
        invitePortal: invitePatientPortal,
      });

      closeForm();
      setVersion((v) => v + 1);

      if (result.portalError) {
        setPageNotice({
          kind: "error",
          message: `Patient saved, but portal invitation failed: ${result.portalError}`,
          patientId: result.patient.id,
        });
      } else if (enrollPortal) {
        setPageNotice({
          kind: "success",
          message: "Patient saved and secure portal invitation sent.",
          patientId: result.patient.id,
        });
      } else {
        setPageNotice({
          kind: "success",
          message: "Patient saved.",
          patientId: result.patient.id,
        });
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unable to create patient.");
    } finally {
      setSaving(false);
    }
  }

  async function edit(client: ClientRow) {
    setFormError(null);
    try {
      const policies = await tenantSelect<Row>("client_insurance_policies", {
        client_id: `eq.${client.id}`,
        order: "insurance_order.asc,created_at.desc",
      });
      const primary = policies.find((row) => String(row.insurance_order ?? "") === "primary");
      const secondary = policies.find((row) => String(row.insurance_order ?? "") === "secondary");
      const next = blankPatient();
      openForm({
        ...next,
        id: client.id,
        first_name: client.firstName,
        last_name: client.lastName,
        preferred_name: client.preferredName || "",
        date_of_birth: client.dateOfBirth || "",
        sex: client.sex || "",
        address_line1: client.addressLine1 || "",
        address_line2: client.addressLine2 || "",
        city: client.city || "",
        state: client.state || "",
        postal_code: client.postalCode || "",
        email: client.email || "",
        phone: client.phone || "",
        billing_type: client.billingType || "insurance",
        metadata: client.metadata || {},
        client_status: client.clientStatus,
        registration_status: client.registrationStatus,
        primary: coverageFromRow(primary, plans, true),
        secondary: coverageFromRow(secondary, plans, false),
      });
    } catch (err) {
      setPageNotice({
        kind: "error",
        message: err instanceof Error ? err.message : "Unable to load patient insurance for editing.",
        patientId: client.id,
      });
    }
  }

  const primaryPlanNames = form ? plans.filter((plan) => plan.payer_id === form.primary.payer_id) : [];
  const secondaryPlanNames = form ? plans.filter((plan) => plan.payer_id === form.secondary.payer_id) : [];

  return <>
    <div className="thera-page-header split">
      <div><div className="thera-eyebrow">PATIENT OPERATIONS</div><h1>Patients</h1><p>Clinical, payer, authorization, claim, payment, and work history in one record.</p></div>
      <div className="thera-filter-row">
        <input className="thera-input" placeholder="Search patients..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <button type="button" className="thera-action" onClick={() => openForm(blankPatient())}>+ Add Patient</button>
      </div>
    </div>

    {pageNotice && <div className={`thera-state${pageNotice.kind === "error" ? " error" : ""}`} style={{ marginBottom: 16 }}>
      {pageNotice.message} <Link href={`/clients/${pageNotice.patientId}`}>Open Patient 360</Link>
      <button type="button" className="thera-action secondary" style={{ marginLeft: 12 }} onClick={() => setPageNotice(null)}>Dismiss</button>
    </div>}

    <section className="thera-card">
      {loading && <div className="thera-state">Loading patients...</div>}
      {error && <div className="thera-state error">{error}</div>}
      {!loading && !error && <div className="thera-table-wrap"><table className="thera-table"><thead><tr><th>Patient</th><th>DOB</th><th>Insurance</th><th>Registration</th><th>Billing Readiness</th><th>Next Appointment</th><th>Open Balance</th><th>Actions</th></tr></thead><tbody>{(data ?? []).map((client) => <tr key={client.id}><td><Link href={`/clients/${client.id}`} className="thera-table-link">{client.firstName} {client.lastName}</Link><div className="thera-table-subtext"><StatusBadge value={client.clientStatus} /></div></td><td>{shortDate(client.dateOfBirth)}</td><td><strong>{client.payerName || "—"}</strong><div className="thera-table-subtext">{client.planName || ""}</div></td><td><StatusBadge value={client.registrationStatus} /></td><td><StatusBadge value={client.billingReadinessStatus} /></td><td>{client.nextAppointment ? dateTime(client.nextAppointment) : "—"}</td><td>{money(client.openBalanceCents)}</td><td><button type="button" className="thera-action secondary" onClick={() => void edit(client)}>Edit</button></td></tr>)}</tbody></table></div>}
    </section>

    {form && <WorkDrawer
      open={Boolean(form)}
      onOpenChange={(open) => { if (!open) closeForm(); }}
      dirty={dirty}
      title={form.id ? "Edit Patient" : "Add Patient"}
      subtitle={form.id ? `${form.first_name} ${form.last_name}` : "Create patient demographics, coverage, and portal access"}
      openFullRecord={form.id ? () => navigate(`/clients/${form.id}`) : undefined}
      openFullRecordLabel="Open Patient 360"
      footer={<div className="thera-filter-row" style={{ justifyContent: "space-between", width: "100%" }}>
        <button type="button" className="thera-action secondary" onClick={closeForm}>Cancel</button>
        <div className="thera-filter-row">
          {!form.id && <button type="button" className="thera-action secondary" disabled={saving || !addRequiredComplete} onClick={() => void save(true)}>Save + Send Portal Invite</button>}
          <button type="button" className="thera-action" disabled={saving || (form.id ? !form.first_name.trim() || !form.last_name.trim() || !form.date_of_birth || !form.sex || !patientAddressComplete(form) : !addRequiredComplete)} onClick={() => void save(false)}>{saving ? "Saving..." : "Save Patient"}</button>
        </div>
      </div>}
    >
      {formError && <div className="thera-state error" style={{ marginBottom: 16 }}>{formError}</div>}
      {!form.id && payerLookupError && <div className="thera-state error" style={{ marginBottom: 16 }}>{payerLookupError}</div>}

      {form.id ? <div className="thera-form-grid">
        <Text label="First Name" value={form.first_name} onChange={(first_name) => setForm({ ...form, first_name })} />
        <Text label="Last Name" value={form.last_name} onChange={(last_name) => setForm({ ...form, last_name })} />
        <Text label="Preferred Name" value={form.preferred_name} onChange={(preferred_name) => setForm({ ...form, preferred_name })} />
        <Text label="DOB" type="date" value={form.date_of_birth} onChange={(date_of_birth) => setForm({ ...form, date_of_birth })} />
        <SexSelect label="Sex" value={form.sex} onChange={(sex) => setForm({ ...form, sex })} />
        <Text label="Address Line 1" value={form.address_line1} onChange={(address_line1) => setForm({ ...form, address_line1 })} />
        <Text label="Address Line 2" value={form.address_line2} onChange={(address_line2) => setForm({ ...form, address_line2 })} />
        <Text label="City" value={form.city} onChange={(city) => setForm({ ...form, city })} />
        <Text label="State" value={form.state} onChange={(state) => setForm({ ...form, state: state.toUpperCase().slice(0, 2) })} />
        <Text label="ZIP Code" value={form.postal_code} onChange={(postal_code) => setForm({ ...form, postal_code })} />
        <Text label="Email" type="email" value={form.email} onChange={(email) => setForm({ ...form, email })} />
        <Text label="Phone" value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
        <label className="thera-field"><span className="thera-field-label">Patient Status</span><select className="thera-input" value={form.client_status} onChange={(e) => setForm({ ...form, client_status: e.target.value })}><option value="active">Active</option><option value="intake">Intake</option><option value="waitlist">Waitlist</option><option value="inactive">Inactive</option><option value="discharged">Discharged</option></select></label>
        <label className="thera-field"><span className="thera-field-label">Registration</span><select className="thera-input" value={form.registration_status} onChange={(e) => setForm({ ...form, registration_status: e.target.value })}><option value="not_started">Not Started</option><option value="in_progress">In Progress</option><option value="pending_review">Pending Review</option><option value="complete">Complete</option><option value="needs_correction">Needs Correction</option></select></label>
      </div> : <div className="thera-stack">
        <section className="thera-card">
          <div className="thera-card-header"><div><h2>Patient Information</h2><p>Required fields are marked *.</p></div></div>
          <div className="thera-form-grid">
            <Text label="Patient First Name *" value={form.first_name} onChange={(first_name) => setForm({ ...form, first_name })} />
            <Text label="Patient Last Name *" value={form.last_name} onChange={(last_name) => setForm({ ...form, last_name })} />
            <Text label="Patient DOB *" type="date" value={form.date_of_birth} onChange={(date_of_birth) => setForm({ ...form, date_of_birth })} />
            <SexSelect label="Patient Sex *" value={form.sex} onChange={(sex) => setForm({ ...form, sex })} />
            <Text label="Patient Address Line 1 *" value={form.address_line1} onChange={(address_line1) => setForm({ ...form, address_line1 })} />
            <Text label="Patient Address Line 2" value={form.address_line2} onChange={(address_line2) => setForm({ ...form, address_line2 })} />
            <Text label="Patient City *" value={form.city} onChange={(city) => setForm({ ...form, city })} />
            <Text label="Patient State *" value={form.state} onChange={(state) => setForm({ ...form, state: state.toUpperCase().slice(0, 2) })} />
            <Text label="Patient ZIP Code *" value={form.postal_code} onChange={(postal_code) => setForm({ ...form, postal_code })} />
            <Text label="Patient Phone *" type="tel" value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
            <Text label="Patient Email *" type="email" value={form.email} onChange={(email) => setForm({ ...form, email })} />
            <label className="thera-field"><span className="thera-field-label">Billing Type *</span><select className="thera-input" value={form.billing_type} onChange={(event) => setForm({ ...form, billing_type: event.target.value as BillingType })}><option value="insurance">Insurance</option><option value="self_pay">Self Pay</option></select></label>
          </div>
        </section>

        <section className="thera-card">
          <div className="thera-card-header"><div><h2>Emergency Contact</h2><p>Optional contact information.</p></div></div>
          <div className="thera-form-grid">
            <Text label="Emergency Contact Name" value={form.emergency_contact_name} onChange={(emergency_contact_name) => setForm({ ...form, emergency_contact_name })} />
            <Text label="Emergency Contact Phone" type="tel" value={form.emergency_contact_phone} onChange={(emergency_contact_phone) => setForm({ ...form, emergency_contact_phone })} />
            <Text label="Emergency Contact Relation to Patient" value={form.emergency_contact_relationship} onChange={(emergency_contact_relationship) => setForm({ ...form, emergency_contact_relationship })} />
          </div>
        </section>

        {form.billing_type === "insurance" && <section className="thera-card">
          <div className="thera-card-header"><div><h2>Insurance Case</h2><p>Primary coverage is required. Secondary coverage is optional.</p></div></div>
          <div className="thera-stack">
            <div><h3>Primary Insurance</h3><div className="thera-form-grid">
              <PayerSelect label="Primary Insurance Company *" value={form.primary.payer_id} payers={payers} onChange={(payer_id) => updateCoverage("primary", { payer_id, plan_name: "" })} />
              <PlanText label="Primary Insurance Plan" value={form.primary.plan_name} listId="primary-plan-options" plans={primaryPlanNames} onChange={(plan_name) => updateCoverage("primary", { plan_name })} />
              <Text label="Primary Insurance Product" value={form.primary.product} onChange={(product) => updateCoverage("primary", { product })} />
              <Text label="Primary Insurance ID *" value={form.primary.member_id} onChange={(member_id) => updateCoverage("primary", { member_id })} />
              <Text label="Primary Insurance Group #" value={form.primary.group_number} onChange={(group_number) => updateCoverage("primary", { group_number })} />
              <RelationshipSelect label="Primary Patient Relation to Subscriber *" value={form.primary.relationship_to_subscriber} required onChange={(relationship_to_subscriber) => updateCoverage("primary", { relationship_to_subscriber })} />
              {form.primary.relationship_to_subscriber !== "self" && <>
                <Text label="Primary Subscriber First Name *" value={form.primary.subscriber_first_name} onChange={(subscriber_first_name) => updateCoverage("primary", { subscriber_first_name })} />
                <Text label="Primary Subscriber Last Name *" value={form.primary.subscriber_last_name} onChange={(subscriber_last_name) => updateCoverage("primary", { subscriber_last_name })} />
                <Text label="Primary Subscriber DOB *" type="date" value={form.primary.subscriber_dob} onChange={(subscriber_dob) => updateCoverage("primary", { subscriber_dob })} />
                <SexSelect label="Primary Subscriber Sex *" value={form.primary.subscriber_sex} onChange={(subscriber_sex) => updateCoverage("primary", { subscriber_sex })} />
                <Text label="Primary Subscriber Address Line 1 *" value={form.primary.subscriber_address_line1} onChange={(subscriber_address_line1) => updateCoverage("primary", { subscriber_address_line1 })} />
                <Text label="Primary Subscriber Address Line 2" value={form.primary.subscriber_address_line2} onChange={(subscriber_address_line2) => updateCoverage("primary", { subscriber_address_line2 })} />
                <Text label="Primary Subscriber City *" value={form.primary.subscriber_city} onChange={(subscriber_city) => updateCoverage("primary", { subscriber_city })} />
                <Text label="Primary Subscriber State *" value={form.primary.subscriber_state} onChange={(subscriber_state) => updateCoverage("primary", { subscriber_state: subscriber_state.toUpperCase().slice(0, 2) })} />
                <Text label="Primary Subscriber ZIP Code *" value={form.primary.subscriber_postal_code} onChange={(subscriber_postal_code) => updateCoverage("primary", { subscriber_postal_code })} />
                <Text label="Primary Subscriber Phone" type="tel" value={form.primary.subscriber_phone} onChange={(subscriber_phone) => updateCoverage("primary", { subscriber_phone })} />
              </>}
            </div></div>

            <div><h3>Secondary Insurance</h3><div className="thera-form-grid">
              <PayerSelect label="Secondary Insurance Company" value={form.secondary.payer_id} payers={payers} onChange={(payer_id) => updateCoverage("secondary", { payer_id, plan_name: "" })} />
              <PlanText label="Secondary Insurance Plan" value={form.secondary.plan_name} listId="secondary-plan-options" plans={secondaryPlanNames} onChange={(plan_name) => updateCoverage("secondary", { plan_name })} />
              <Text label="Secondary Insurance Product" value={form.secondary.product} onChange={(product) => updateCoverage("secondary", { product })} />
              <Text label="Secondary Insurance ID" value={form.secondary.member_id} onChange={(member_id) => updateCoverage("secondary", { member_id })} />
              <Text label="Secondary Insurance Group #" value={form.secondary.group_number} onChange={(group_number) => updateCoverage("secondary", { group_number })} />
              <RelationshipSelect label="Secondary Patient Relation to Subscriber" value={form.secondary.relationship_to_subscriber} onChange={(relationship_to_subscriber) => updateCoverage("secondary", { relationship_to_subscriber })} />
              {form.secondary.relationship_to_subscriber && form.secondary.relationship_to_subscriber !== "self" && <>
                <Text label="Secondary Subscriber First Name *" value={form.secondary.subscriber_first_name} onChange={(subscriber_first_name) => updateCoverage("secondary", { subscriber_first_name })} />
                <Text label="Secondary Subscriber Last Name *" value={form.secondary.subscriber_last_name} onChange={(subscriber_last_name) => updateCoverage("secondary", { subscriber_last_name })} />
                <Text label="Secondary Subscriber DOB *" type="date" value={form.secondary.subscriber_dob} onChange={(subscriber_dob) => updateCoverage("secondary", { subscriber_dob })} />
                <SexSelect label="Secondary Subscriber Sex *" value={form.secondary.subscriber_sex} onChange={(subscriber_sex) => updateCoverage("secondary", { subscriber_sex })} />
                <Text label="Secondary Subscriber Address Line 1 *" value={form.secondary.subscriber_address_line1} onChange={(subscriber_address_line1) => updateCoverage("secondary", { subscriber_address_line1 })} />
                <Text label="Secondary Subscriber Address Line 2" value={form.secondary.subscriber_address_line2} onChange={(subscriber_address_line2) => updateCoverage("secondary", { subscriber_address_line2 })} />
                <Text label="Secondary Subscriber City *" value={form.secondary.subscriber_city} onChange={(subscriber_city) => updateCoverage("secondary", { subscriber_city })} />
                <Text label="Secondary Subscriber State *" value={form.secondary.subscriber_state} onChange={(subscriber_state) => updateCoverage("secondary", { subscriber_state: subscriber_state.toUpperCase().slice(0, 2) })} />
                <Text label="Secondary Subscriber ZIP Code *" value={form.secondary.subscriber_postal_code} onChange={(subscriber_postal_code) => updateCoverage("secondary", { subscriber_postal_code })} />
                <Text label="Secondary Subscriber Phone" type="tel" value={form.secondary.subscriber_phone} onChange={(subscriber_phone) => updateCoverage("secondary", { subscriber_phone })} />
              </>}
            </div></div>
          </div>
        </section>}

        {form.billing_type === "self_pay" && <section className="thera-card">
          <div className="thera-card-header"><div><h2>Self-Pay Billing</h2><p>No insurance policy is required.</p></div></div>
          <div className="thera-alert">Services will route to patient responsibility instead of payer claim creation.</div>
        </section>}

        <div className="thera-muted">Use “Save + Send Portal Invite” to save the patient once and send their secure portal invitation.</div>
      </div>}
    </WorkDrawer>}
  </>;
}

function Text({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <label className="thera-field"><span className="thera-field-label">{label}</span><input className="thera-input" type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function SexSelect({ label, value, onChange }: { label: string; value: Sex; onChange: (value: Sex) => void }) {
  return <label className="thera-field"><span className="thera-field-label">{label}</span><select className="thera-input" value={value} onChange={(event) => onChange(event.target.value as Sex)}><option value="">Select</option><option value="M">M</option><option value="F">F</option></select></label>;
}

function RelationshipSelect({ label, value, onChange, required = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <label className="thera-field"><span className="thera-field-label">{label}</span><select className="thera-input" value={value} required={required} onChange={(event) => onChange(event.target.value)}><option value="">Select relationship</option>{RELATIONSHIPS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>;
}

function PayerSelect({ label, value, payers, onChange }: { label: string; value: string; payers: PayerRow[]; onChange: (value: string) => void }) {
  return <label className="thera-field"><span className="thera-field-label">{label}</span><select className="thera-input" value={value} onChange={(event) => onChange(event.target.value)}><option value="">Select insurance company</option>{payers.map((payer) => <option key={payer.id} value={payer.id}>{payer.name}</option>)}</select></label>;
}

function PlanText({ label, value, listId, plans, onChange }: { label: string; value: string; listId: string; plans: PayerPlanRow[]; onChange: (value: string) => void }) {
  return <label className="thera-field"><span className="thera-field-label">{label}</span><input className="thera-input" list={listId} value={value} onChange={(event) => onChange(event.target.value)} /><datalist id={listId}>{plans.map((plan) => <option key={plan.id} value={plan.name}>{plan.plan_type || ""}</option>)}</datalist></label>;
}
