import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";

import { useTenant } from "./tenant-context";
import {
  completeOnboarding,
  configureSelectedNetworks,
  createPracticeFromOnboarding,
  createProviderFromOnboarding,
  createTestPatient,
  getOnboardingRecord,
  saveOnboardingProgress,
  saveSelfPayRates,
  uploadOnboardingDocument,
  type PracticeOnboardingDraft,
  type ProviderOnboardingDraft,
  type SelfPayRate,
} from "./onboarding-repository";

type StaffDraft = { name: string; email: string; role: string };
type ProviderDraft = ProviderOnboardingDraft & { files: Record<string, File | null> };

const blankProvider = (): ProviderDraft => ({
  fullName: "",
  caqhId: "",
  npi: "",
  licenseNumber: "",
  dob: "",
  ssn: "",
  taxonomyCode: "",
  medicaidId: "",
  ptan: "",
  supervisor: "",
  delegates: "",
  files: {},
});

const blankPractice: PracticeOnboardingDraft = {
  practiceName: "",
  primaryLocation: "",
  npi2: "",
  tin: "",
  additionalLocations: [],
};

const networkOptions = [
  ["aetna", "AETNA"],
  ["bcbs", "BCBS"],
  ["cigna", "CIGNA"],
  ["colorado_access", "COLORADO ACCESS"],
  ["ccha", "CCHA"],
  ["medicare", "MEDICARE"],
  ["rmhp", "RMHP"],
  ["uhc", "UHC"],
  ["tricare", "TRICARE"],
  ["other", "OTHER"],
] as const;

const commonBehavioralHealthRates: SelfPayRate[] = [
  { cpt: "90791", amount: "" },
  { cpt: "90832", amount: "" },
  { cpt: "90834", amount: "" },
  { cpt: "90837", amount: "" },
  { cpt: "90846", amount: "" },
  { cpt: "90847", amount: "" },
  { cpt: "90853", amount: "" },
];

const providerUploadFields = [
  ["license", "Upload License"],
  ["w9", "Upload W-9"],
  ["malpractice_insurance", "Upload Insurance"],
  ["voided_check", "Upload Voided Check"],
  ["id_dl", "Upload ID / Driver License"],
  ["dea", "Upload DEA"],
  ["certifications", "Upload Certifications"],
] as const;

const totalSteps = 14;

function downloadCsv(name: string, headers: string[]) {
  const blob = new Blob([headers.join(",") + "\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function YesNo({
  value,
  onChange,
  yes = "Yes",
  no = "No",
}: {
  value: boolean | null;
  onChange(value: boolean): void;
  yes?: string;
  no?: string;
}) {
  return (
    <div className="thera-filter-row">
      <button type="button" className={value === true ? "thera-action" : "thera-action secondary"} onClick={() => onChange(true)}>{yes}</button>
      <button type="button" className={value === false ? "thera-action" : "thera-action secondary"} onClick={() => onChange(false)}>{no}</button>
    </div>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span className="thera-field-label">{label}</span>
      {children}
      {hint ? <small className="thera-table-subtext">{hint}</small> : null}
    </label>
  );
}

function StepFrame({
  step,
  title,
  subtitle,
  children,
  onContinue,
  continueLabel = "Continue",
  working,
  error,
}: {
  step: number;
  title: string;
  subtitle?: string;
  children: ReactNode;
  onContinue(): void;
  continueLabel?: string;
  working: boolean;
  error: string | null;
}) {
  return (
    <main className="thera-main" style={{ minHeight: "100vh", padding: 24 }}>
      <section className="thera-card" style={{ width: "min(1060px, 100%)", margin: "0 auto" }}>
        <div className="thera-brand" style={{ marginBottom: 20 }}>
          <div className="thera-brand-mark">T</div>
          <div>
            <div className="thera-brand-name">THERASSISTANT EHR</div>
            <div className="thera-brand-subtitle">Practice Setup · Step {step} of {totalSteps}</div>
          </div>
        </div>
        <div className="thera-card-header">
          <div><h1>{title}</h1>{subtitle ? <p>{subtitle}</p> : null}</div>
        </div>
        <div style={{ display: "grid", gap: 18 }}>{children}</div>
        {error ? <div className="thera-state error" style={{ marginTop: 18 }}>{error}</div> : null}
        <div className="thera-filter-row" style={{ justifyContent: "flex-end", marginTop: 24 }}>
          <button type="button" className="thera-action" disabled={working} onClick={onContinue}>
            {working ? "Saving…" : continueLabel}
          </button>
        </div>
      </section>
    </main>
  );
}

function ProviderCard({
  provider,
  index,
  onChange,
  onRemove,
}: {
  provider: ProviderDraft;
  index: number;
  onChange(next: ProviderDraft): void;
  onRemove?: () => void;
}) {
  const input = (key: keyof ProviderOnboardingDraft) => ({
    value: String(provider[key] ?? ""),
    onChange: (event: ChangeEvent<HTMLInputElement>) => onChange({ ...provider, [key]: event.target.value }),
  });
  return (
    <section className="thera-card" style={{ padding: 18 }}>
      <div className="thera-card-header split">
        <div><h3>Provider {index + 1}</h3><p>Credentialing identity and source documents.</p></div>
        {onRemove ? <button type="button" className="thera-action secondary" onClick={onRemove}>Remove</button> : null}
      </div>
      <div className="thera-grid thera-grid-3">
        <Field label="Full Name"><input className="thera-input" {...input("fullName")} /></Field>
        <Field label="CAQH ID"><input className="thera-input" {...input("caqhId")} /></Field>
        <Field label="NPI"><input className="thera-input" inputMode="numeric" maxLength={10} {...input("npi")} /></Field>
        <Field label="License #"><input className="thera-input" {...input("licenseNumber")} /></Field>
        <Field label="DOB"><input className="thera-input" type="date" {...input("dob")} /></Field>
        <Field label="SSN" hint="Stored in Supabase Vault; only the last four are indexed in the EHR.">
          <input className="thera-input" type="password" inputMode="numeric" maxLength={11} autoComplete="off" {...input("ssn")} />
        </Field>
        <Field label="Taxonomy Code"><input className="thera-input" maxLength={10} {...input("taxonomyCode")} /></Field>
        <Field label="Medicaid ID"><input className="thera-input" {...input("medicaidId")} /></Field>
        <Field label="PTAN"><input className="thera-input" {...input("ptan")} /></Field>
        <Field label="Supervisor (if any)"><input className="thera-input" {...input("supervisor")} /></Field>
        <Field label="Delegates (if any)"><input className="thera-input" placeholder="Names or emails, comma separated" {...input("delegates")} /></Field>
      </div>
      <div className="thera-grid thera-grid-3" style={{ marginTop: 16 }}>
        {providerUploadFields.map(([key, label]) => (
          <Field key={key} label={label}>
            <input className="thera-input" type="file" onChange={(event) => onChange({
              ...provider,
              files: { ...provider.files, [key]: event.target.files?.[0] ?? null },
            })} />
          </Field>
        ))}
      </div>
    </section>
  );
}

export function OnboardingWizard() {
  const {
    tenantId,
    onboardingStep,
    bootstrapOrganization,
    refreshTenant,
  } = useTenant();

  const [step, setStep] = useState(onboardingStep ?? 1);
  const [providers, setProviders] = useState<ProviderDraft[]>([blankProvider()]);
  const [providerIds, setProviderIds] = useState<string[]>([]);
  const [staff, setStaff] = useState<StaffDraft[]>([]);
  const [practice, setPractice] = useState<PracticeOnboardingDraft>(blankPractice);
  const [practiceEntityId, setPracticeEntityId] = useState<string | null>(null);
  const [cp575File, setCp575File] = useState<File | null>(null);
  const [networkKeys, setNetworkKeys] = useState<string[]>([]);
  const [otherPayers, setOtherPayers] = useState("");
  const [selfPay, setSelfPay] = useState<boolean | null>(null);
  const [rates, setRates] = useState<SelfPayRate[]>(commonBehavioralHealthRates);
  const [importPatients, setImportPatients] = useState<boolean | null>(null);
  const [addTestPatient, setAddTestPatient] = useState<boolean | null>(null);
  const [scheduleDays, setScheduleDays] = useState<string[]>(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
  const [scheduleStart, setScheduleStart] = useState("09:00");
  const [scheduleEnd, setScheduleEnd] = useState("17:00");
  const [importBilling, setImportBilling] = useState<boolean | null>(null);
  const [addTestPayment, setAddTestPayment] = useState<boolean | null>(null);
  const [contractFiles, setContractFiles] = useState<File[]>([]);
  const [correspondenceFiles, setCorrespondenceFiles] = useState<File[]>([]);
  const [customizeNotes, setCustomizeNotes] = useState<boolean | null>(null);
  const [noteTemplates, setNoteTemplates] = useState<string[]>(["Psychotherapy", "Assessment", "Intake"]);
  const [ownClearinghouse, setOwnClearinghouse] = useState<boolean | null>(null);
  const [clearinghouseName, setClearinghouseName] = useState("");
  const [billingMode, setBillingMode] = useState<"manual" | "built_in">("manual");
  const [stripe, setStripe] = useState<boolean | null>(null);
  const [emailConnection, setEmailConnection] = useState<boolean | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    let active = true;
    void getOnboardingRecord().then((row) => {
      if (!active || !row) return;
      setStep(Number(row.current_step ?? onboardingStep ?? 1));
      const data = row.data && typeof row.data === "object" && !Array.isArray(row.data)
        ? row.data as Record<string, any>
        : {};
      if (Array.isArray(data.provider_ids)) setProviderIds(data.provider_ids.map(String));
      if (data.practice_entity_id) setPracticeEntityId(String(data.practice_entity_id));
      if (data.practice && typeof data.practice === "object") {
        setPractice((current) => ({ ...current, ...data.practice }));
      }
      if (Array.isArray(data.network_keys)) setNetworkKeys(data.network_keys.map(String));
    }).catch(() => {});
    return () => { active = false; };
  }, [tenantId, onboardingStep]);

  const practiceName = practice.practiceName.trim();
  const serializableProviders = useMemo(() => providers.map(({ files: _files, ssn: _ssn, ...provider }) => provider), [providers]);

  async function run(action: () => Promise<void>) {
    setWorking(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save this setup step.");
    } finally {
      setWorking(false);
    }
  }

  async function saveProviderAndPractice() {
    if (!practiceName) throw new Error("Practice Name is required.");
    if (practice.npi2 && !/^\d{10}$/.test(practice.npi2.replace(/\D/g, ""))) {
      throw new Error("NPI 2 must contain exactly 10 digits.");
    }
    for (const provider of providers) {
      if (!provider.fullName.trim()) throw new Error("Enter each provider's full name.");
      if (!/^\d{10}$/.test(provider.npi.replace(/\D/g, ""))) throw new Error("Each provider NPI must contain exactly 10 digits.");
    }

    if (!tenantId) await bootstrapOrganization(practiceName, "practice");

    let nextPracticeEntityId = practiceEntityId;
    if (!nextPracticeEntityId) {
      const created = await createPracticeFromOnboarding(practice);
      nextPracticeEntityId = created.entity.id;
      setPracticeEntityId(nextPracticeEntityId);
      if (cp575File) {
        await uploadOnboardingDocument({
          file: cp575File,
          category: "cp575",
          practiceEntityId: nextPracticeEntityId,
        });
      }
    }

    const nextProviderIds = [...providerIds];
    for (let index = 0; index < providers.length; index += 1) {
      const provider = providers[index];
      let id = nextProviderIds[index];
      if (!id) {
        const created = await createProviderFromOnboarding(provider);
        id = created.id;
        nextProviderIds[index] = id;
      }
      for (const [category, file] of Object.entries(provider.files)) {
        if (!file) continue;
        await uploadOnboardingDocument({ file, category, providerId: id });
      }
    }
    setProviderIds(nextProviderIds);

    await saveOnboardingProgress(3, {
      providers: serializableProviders,
      provider_ids: nextProviderIds,
      staff_members: staff,
      practice,
      practice_entity_id: nextPracticeEntityId,
    });
    setStep(3);
  }

  const next = (value: number) => setStep(Math.max(1, Math.min(totalSteps, value)));

  if (step === 1) {
    return (
      <StepFrame step={1} title="Provider Information" subtitle="Add the provider identity and credentialing information needed to operate and bill." working={working} error={error}
        onContinue={() => void run(async () => { next(2); })}>
        {providers.map((provider, index) => (
          <ProviderCard key={index} provider={provider} index={index}
            onChange={(nextProvider) => setProviders((current) => current.map((item, i) => i === index ? nextProvider : item))}
            onRemove={index === 0 ? undefined : () => setProviders((current) => current.filter((_, i) => i !== index))} />
        ))}
        <YesNo value={providers.length > 1} onChange={(yes) => {
          if (yes) setProviders((current) => [...current, blankProvider()]);
          else setProviders((current) => current.slice(0, 1));
        }} yes="Add Another Provider" no="One Provider Only" />
        <section className="thera-card" style={{ padding: 18 }}>
          <div className="thera-card-header"><div><h3>Staff Members</h3><p>Add staff records to carry into user setup after onboarding.</p></div></div>
          {staff.map((member, index) => (
            <div className="thera-grid thera-grid-3" key={index} style={{ marginBottom: 10 }}>
              <input className="thera-input" placeholder="Full name" value={member.name} onChange={(e) => setStaff((rows) => rows.map((row, i) => i === index ? { ...row, name: e.target.value } : row))} />
              <input className="thera-input" type="email" placeholder="Email" value={member.email} onChange={(e) => setStaff((rows) => rows.map((row, i) => i === index ? { ...row, email: e.target.value } : row))} />
              <select className="thera-input" value={member.role} onChange={(e) => setStaff((rows) => rows.map((row, i) => i === index ? { ...row, role: e.target.value } : row))}>
                <option value="front_desk">Front Desk</option><option value="biller">Biller</option><option value="billing_manager">Billing Manager</option>
                <option value="clinician">Clinician</option><option value="credentialing_specialist">Credentialing Specialist</option><option value="read_only">Read Only</option>
              </select>
            </div>
          ))}
          <YesNo value={staff.length > 0} onChange={(yes) => yes ? setStaff((rows) => rows.length ? rows : [{ name: "", email: "", role: "front_desk" }]) : setStaff([])}
            yes="Add a Staff Member" no="No Staff Yet" />
        </section>
      </StepFrame>
    );
  }

  if (step === 2) {
    return (
      <StepFrame step={2} title="Practice Information" subtitle="Create the practice entity and its initial service location." working={working} error={error}
        onContinue={() => void run(saveProviderAndPractice)}>
        <div className="thera-grid thera-grid-2">
          <Field label="Practice Name"><input className="thera-input" value={practice.practiceName} onChange={(e) => setPractice({ ...practice, practiceName: e.target.value })} /></Field>
          <Field label="Practice Location"><input className="thera-input" placeholder="Street address / location" value={practice.primaryLocation} onChange={(e) => setPractice({ ...practice, primaryLocation: e.target.value })} /></Field>
          <Field label="NPI 2"><input className="thera-input" inputMode="numeric" maxLength={10} value={practice.npi2} onChange={(e) => setPractice({ ...practice, npi2: e.target.value.replace(/\D/g, "") })} /></Field>
          <Field label="TIN"><input className="thera-input" inputMode="numeric" maxLength={9} value={practice.tin} onChange={(e) => setPractice({ ...practice, tin: e.target.value.replace(/\D/g, "") })} /></Field>
          <Field label="Upload CP575"><input className="thera-input" type="file" onChange={(e) => setCp575File(e.target.files?.[0] ?? null)} /></Field>
        </div>
        {practice.additionalLocations.map((location, index) => (
          <div className="thera-filter-row" key={index}>
            <input className="thera-input" style={{ flex: 1 }} placeholder={`Additional Location ${index + 2}`} value={location}
              onChange={(e) => setPractice({ ...practice, additionalLocations: practice.additionalLocations.map((item, i) => i === index ? e.target.value : item) })} />
            <button className="thera-action secondary" type="button" onClick={() => setPractice({ ...practice, additionalLocations: practice.additionalLocations.filter((_, i) => i !== index) })}>Remove</button>
          </div>
        ))}
        <YesNo value={practice.additionalLocations.length > 0}
          onChange={(yes) => setPractice({ ...practice, additionalLocations: yes ? [...practice.additionalLocations, ""] : [] })}
          yes="Add Another Location" no="No Additional Locations" />
      </StepFrame>
    );
  }

  if (step === 3) {
    return (
      <StepFrame step={3} title="Select Your In-Insurance Networks" subtitle="Selected networks seed the payer mix, payer IDs and fee-schedule workspace. Contract/effective-date verification remains required before production billing." working={working} error={error}
        onContinue={() => void run(async () => {
          if (!practiceEntityId) throw new Error("Practice setup must be completed before payer setup.");
          const configured = await configureSelectedNetworks(networkKeys.filter((key) => key !== "other"), practiceEntityId);
          if (selfPay) await saveSelfPayRates(rates);
          await saveOnboardingProgress(4, {
            network_keys: networkKeys,
            configured_payers: configured,
            other_payers: otherPayers,
            self_pay_enabled: selfPay === true,
          });
          next(4);
        })}>
        <div className="thera-filter-row" style={{ flexWrap: "wrap" }}>
          {networkOptions.map(([key, label]) => (
            <button key={key} type="button" className={networkKeys.includes(key) ? "thera-action" : "thera-action secondary"}
              onClick={() => setNetworkKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])}>
              {label}
            </button>
          ))}
        </div>
        {networkKeys.includes("other") ? <Field label="Other Payer(s)"><input className="thera-input" placeholder="Payer names, comma separated" value={otherPayers} onChange={(e) => setOtherPayers(e.target.value)} /></Field> : null}
        <section className="thera-card" style={{ padding: 18 }}>
          <h3>Add Self-Pay Rates?</h3>
          <YesNo value={selfPay} onChange={setSelfPay} />
          {selfPay ? (
            <div className="thera-table-wrap" style={{ marginTop: 14 }}><table className="thera-table"><thead><tr><th>CPT</th><th>Charge Amount</th></tr></thead>
              <tbody>{rates.map((rate, index) => <tr key={rate.cpt}>
                <td><input className="thera-input" value={rate.cpt} onChange={(e) => setRates((rows) => rows.map((row, i) => i === index ? { ...row, cpt: e.target.value.toUpperCase() } : row))} /></td>
                <td><input className="thera-input" type="number" step="0.01" min="0" placeholder="0.00" value={rate.amount} onChange={(e) => setRates((rows) => rows.map((row, i) => i === index ? { ...row, amount: e.target.value } : row))} /></td>
              </tr>)}</tbody></table></div>
          ) : null}
        </section>
      </StepFrame>
    );
  }

  if (step === 4) {
    return (
      <StepFrame step={4} title="Upload Your Patient List?" working={working} error={error}
        onContinue={() => void run(async () => {
          if (addTestPatient) await createTestPatient();
          await saveOnboardingProgress(5, { import_patient_list: importPatients === true, add_test_patient: addTestPatient === true });
          next(5);
        })}>
        <YesNo value={importPatients} onChange={setImportPatients} />
        {importPatients ? (
          <button type="button" className="thera-action secondary" onClick={() => downloadCsv("therassistant-patient-import-template.csv", [
            "first_name","middle_name","last_name","preferred_name","date_of_birth","sex","email","phone","address_line1","address_line2","city","state","postal_code","payer_name","member_id","group_number"
          ])}>Download Patient Import Template</button>
        ) : importPatients === false ? (
          <section className="thera-card" style={{ padding: 18 }}><h3>Add a Test Patient?</h3><YesNo value={addTestPatient} onChange={setAddTestPatient} /></section>
        ) : null}
      </StepFrame>
    );
  }

  if (step === 5) {
    return (
      <StepFrame step={5} title="Set Your Appointment Schedule" subtitle="Set the initial weekly availability that will carry into scheduling setup." working={working} error={error}
        onContinue={() => void run(async () => {
          await saveOnboardingProgress(6, { schedule: { days: scheduleDays, start: scheduleStart, end: scheduleEnd } });
          next(6);
        })}>
        <div className="thera-filter-row" style={{ flexWrap: "wrap" }}>
          {["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((day) => (
            <button key={day} type="button" className={scheduleDays.includes(day) ? "thera-action" : "thera-action secondary"}
              onClick={() => setScheduleDays((days) => days.includes(day) ? days.filter((item) => item !== day) : [...days, day])}>{day.slice(0,3)}</button>
          ))}
        </div>
        <div className="thera-grid thera-grid-2">
          <Field label="Start Time"><input className="thera-input" type="time" value={scheduleStart} onChange={(e) => setScheduleStart(e.target.value)} /></Field>
          <Field label="End Time"><input className="thera-input" type="time" value={scheduleEnd} onChange={(e) => setScheduleEnd(e.target.value)} /></Field>
        </div>
      </StepFrame>
    );
  }

  if (step === 6) {
    return (
      <StepFrame step={6} title="Import Old Billing Records?" working={working} error={error}
        onContinue={() => void run(async () => {
          await saveOnboardingProgress(7, { import_old_billing: importBilling === true, add_test_payment: addTestPayment === true });
          next(7);
        })}>
        <YesNo value={importBilling} onChange={setImportBilling} />
        {importBilling ? (
          <button type="button" className="thera-action secondary" onClick={() => downloadCsv("therassistant-billing-import-template.csv", [
            "patient_external_id","service_date","payer_name","claim_number","cpt_code","modifier","units","charge_amount","allowed_amount","payer_paid","patient_paid","adjustment_amount","balance"
          ])}>Download Billing Import Template</button>
        ) : importBilling === false ? (
          <section className="thera-card" style={{ padding: 18 }}><h3>Add a Test Payment?</h3><YesNo value={addTestPayment} onChange={setAddTestPayment} /></section>
        ) : null}
      </StepFrame>
    );
  }

  if (step === 7) {
    return (
      <StepFrame step={7} title="Upload Contracts?" working={working} error={error}
        onContinue={() => void run(async () => {
          if (practiceEntityId) for (const file of contractFiles) await uploadOnboardingDocument({ file, category: "payer_contract", practiceEntityId });
          await saveOnboardingProgress(8, { contracts_uploaded: contractFiles.length });
          next(8);
        })}>
        <input className="thera-input" type="file" multiple onChange={(e) => setContractFiles(Array.from(e.target.files ?? []))} />
      </StepFrame>
    );
  }

  if (step === 8) {
    return (
      <StepFrame step={8} title="Upload Mailed Correspondence for Filing?" working={working} error={error}
        onContinue={() => void run(async () => {
          if (practiceEntityId) for (const file of correspondenceFiles) await uploadOnboardingDocument({ file, category: "mailed_correspondence", practiceEntityId });
          await saveOnboardingProgress(9, { mailed_correspondence_uploaded: correspondenceFiles.length });
          next(9);
        })}>
        <input className="thera-input" type="file" multiple onChange={(e) => setCorrespondenceFiles(Array.from(e.target.files ?? []))} />
      </StepFrame>
    );
  }

  if (step === 9) {
    return (
      <StepFrame step={9} title="Customize Note Templates?" working={working} error={error}
        onContinue={() => void run(async () => {
          await saveOnboardingProgress(10, { customize_note_templates: customizeNotes === true, note_templates: noteTemplates });
          next(10);
        })}>
        <YesNo value={customizeNotes} onChange={setCustomizeNotes} />
        {customizeNotes ? <div className="thera-filter-row" style={{ flexWrap: "wrap" }}>
          {["Psychotherapy","Assessment","Intake","Crisis","Case Management","Medication Management"].map((name) => (
            <button key={name} type="button" className={noteTemplates.includes(name) ? "thera-action" : "thera-action secondary"}
              onClick={() => setNoteTemplates((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name])}>{name}</button>
          ))}
        </div> : null}
      </StepFrame>
    );
  }

  if (step === 10) {
    return (
      <StepFrame step={10} title="Connect Your Own Clearinghouse?" working={working} error={error}
        onContinue={() => void run(async () => {
          await saveOnboardingProgress(11, {
            clearinghouse: ownClearinghouse
              ? { mode: "external", name: clearinghouseName }
              : { mode: billingMode },
          });
          next(11);
        })}>
        <YesNo value={ownClearinghouse} onChange={setOwnClearinghouse} />
        {ownClearinghouse ? <Field label="Clearinghouse"><input className="thera-input" placeholder="Clearinghouse name" value={clearinghouseName} onChange={(e) => setClearinghouseName(e.target.value)} /></Field> : ownClearinghouse === false ? (
          <div className="thera-filter-row">
            <button type="button" className={billingMode === "manual" ? "thera-action" : "thera-action secondary"} onClick={() => setBillingMode("manual")}>Manual Billing</button>
            <button type="button" className={billingMode === "built_in" ? "thera-action" : "thera-action secondary"} onClick={() => setBillingMode("built_in")}>Built-In Clearinghouse for a Fee</button>
          </div>
        ) : null}
      </StepFrame>
    );
  }

  if (step === 11) {
    return (
      <StepFrame step={11} title="Connect Your Stripe Account?" subtitle="Selecting Yes queues Stripe connection setup in Connected Operations." working={working} error={error}
        onContinue={() => void run(async () => { await saveOnboardingProgress(12, { connect_stripe: stripe === true }); next(12); })}>
        <YesNo value={stripe} onChange={setStripe} />
      </StepFrame>
    );
  }

  if (step === 12) {
    return (
      <StepFrame step={12} title="Connect Your Email?" subtitle="Selecting Yes queues email connection setup in Connected Operations." working={working} error={error}
        onContinue={() => void run(async () => { await saveOnboardingProgress(13, { connect_email: emailConnection === true }); next(13); })}>
        <YesNo value={emailConnection} onChange={setEmailConnection} />
      </StepFrame>
    );
  }

  if (step === 13) {
    return (
      <StepFrame step={13} title="Upload a Logo?" working={working} error={error}
        onContinue={() => void run(async () => {
          let logoDocumentId: string | null = null;
          if (logoFile && practiceEntityId) {
            const doc = await uploadOnboardingDocument({ file: logoFile, category: "practice_logo", practiceEntityId });
            logoDocumentId = doc.id;
          }
          await saveOnboardingProgress(14, { logo_document_id: logoDocumentId });
          next(14);
        })}>
        <input className="thera-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} />
      </StepFrame>
    );
  }

  return (
    <StepFrame step={14} title={`Welcome to THERASSISTANT EHR${practiceName ? `, ${practiceName}!` : "!"}`}
      subtitle="Your core EHR setup is ready. Network contracts and fee schedules that still need rates or evidence remain visibly incomplete instead of being treated as verified."
      working={working} error={error} continueLabel="Enter THERASSISTANT EHR"
      onContinue={() => void run(async () => {
        await completeOnboarding();
        refreshTenant();
      })}>
      <div className="thera-grid thera-grid-3">
        <div className="thera-card"><strong>{providerIds.length}</strong><div className="thera-table-subtext">Provider records created</div></div>
        <div className="thera-card"><strong>{networkKeys.filter((key) => key !== "other").length}</strong><div className="thera-table-subtext">Network selections configured</div></div>
        <div className="thera-card"><strong>{staff.length}</strong><div className="thera-table-subtext">Staff entries carried into setup</div></div>
      </div>
      {(stripe || emailConnection || ownClearinghouse || billingMode === "built_in") ? (
        <div className="thera-state">
          Connection requests are saved. After entering the EHR, open Connected Operations to complete provider authorization for the selected external services.
        </div>
      ) : null}
    </StepFrame>
  );
}
