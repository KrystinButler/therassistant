import { useState } from "react";
import { Link } from "wouter";
import { UserRolesPage } from "./users-roles";
import { ProvidersPage } from "./providers";
import { PracticeConfigurationPage } from "./practice-configuration";

export function PracticeOnboarding() {
  const [step, setStep] = useState(0);
  const labels = ["Add Users", "Providers", "Practice Configuration", "Credentialing", "Add Patient"];
  return <>
    <div className="thera-page-header"><h1>Set up your practice</h1><p>Complete each step in order. You can return here from Practice Setup.</p></div>
    <nav className="thera-filter-row" aria-label="Practice setup steps">{labels.map((label, i) => <button type="button" key={label} className={i === step ? "thera-action" : "thera-action secondary"} aria-current={i === step ? "step" : undefined} onClick={() => setStep(i)}>{i + 1}. {label}</button>)}</nav>
    <div style={{ marginTop: 24 }}>{step === 0 ? <UserRolesPage /> : step === 1 ? <ProvidersPage /> : step === 2 ? <PracticeConfigurationPage /> : step === 3 ? <section className="thera-card"><h2>Credentialing</h2><p>Review provider enrollment and payer participation in the credentialing module.</p><Link className="thera-action" href="/credentialing">Open Credentialing</Link></section> : <section className="thera-card"><h2>Add your first patient</h2><p>With users, providers, and practice settings in place, open Patients to add a patient.</p><Link className="thera-action" href="/clients">Open Patients</Link></section>}</div>
    <div className="thera-filter-row" style={{ marginTop: 24 }}><button className="thera-action secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button><button className="thera-action" disabled={step === 4} onClick={() => setStep(step + 1)}>Continue to {labels[step + 1] ?? "Patients"}</button></div>
  </>;
}
