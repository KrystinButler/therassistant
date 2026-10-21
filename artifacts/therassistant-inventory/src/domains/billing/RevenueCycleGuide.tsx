import { useState } from "react";
import { Link } from "wouter";
import "./revenue-cycle-guide.css";

const stages = [
  {
    title: "Prepare",
    purpose: "Confirm who is receiving care, which coverage applies, and whether the service is ready to schedule.",
    check: "Review patient and policy details, eligibility for the service date, authorization needs, and provider participation.",
    mistake: "An active eligibility response alone does not confirm authorization or guarantee payment.",
    links: [{ label: "Review eligibility", href: "/eligibility" }, { label: "Open patients", href: "/clients" }],
  },
  {
    title: "Document",
    purpose: "Record the care delivered so the clinical record supports the service being billed.",
    check: "Open the encounter, review intake and treatment goals, document the service, and complete the signature workflow.",
    mistake: "A scheduled visit is not proof that the service occurred. Confirm the encounter and documentation before billing.",
    links: [{ label: "Open clinical workspace", href: "/clinical" }],
  },
  {
    title: "Capture charges",
    purpose: "Turn the documented service into a charge that can be reviewed for a claim.",
    check: "Compare the charge with the encounter: service date, rendering provider, diagnosis, procedure, units, modifiers, and place of service.",
    mistake: "An unsigned note or unresolved charge exception can leave the service waiting before claim creation.",
    links: [{ label: "Review charges", href: "/billing/charges" }],
  },
  {
    title: "Submit claims",
    purpose: "Send a reviewed claim and follow its progress through clearinghouse and payer responses.",
    check: "Resolve validation issues, submit from the charge workflow, then review acknowledgments and claim status.",
    mistake: "Submitted does not mean accepted or paid. A rejection needs correction; a payer denial needs review after adjudication.",
    links: [{ label: "Track claims", href: "/claims" }, { label: "Resolve rejections", href: "/rejections" }],
  },
  {
    title: "Reconcile payments",
    purpose: "Match the payer's decision and money received to the services billed, then resolve what remains.",
    check: "Review remittance details, apply payments and adjustments, investigate remaining balances, and compare activity with reports.",
    mistake: "Importing a remittance is not the same as completing posting. Check unapplied money, underpayments, denials, and patient responsibility.",
    links: [{ label: "Open payments", href: "/payments" }, { label: "Review denials", href: "/denials" }, { label: "View reports", href: "/reports" }],
  },
];

export function RevenueCycleGuide() {
  const [selected, setSelected] = useState(0);
  const stage = stages[selected];

  return (
    <details className="thera-card revenue-cycle-guide" open>
      <summary>Learn the revenue cycle</summary>
      <p>Follow a service from preparation to payment. Choose a stage to see its purpose and next action.</p>
      <div className="revenue-cycle-guide-stages" role="group" aria-label="Revenue cycle stages">
        {stages.map((item, index) => (
          <button key={item.title} type="button" aria-pressed={selected === index}
            aria-controls="revenue-cycle-guide-detail" onClick={() => setSelected(index)}>
            <span aria-hidden="true">{index + 1}. </span>{item.title}
          </button>
        ))}
      </div>
      <div id="revenue-cycle-guide-detail" className="revenue-cycle-guide-detail" aria-live="polite" aria-atomic="true">
        <h3>{selected + 1}. {stage.title}</h3>
        <p>{stage.purpose}</p>
        <p><strong>What to check:</strong> {stage.check}</p>
        <p><strong>Common mistake:</strong> {stage.mistake}</p>
        <div className="thera-filter-row">
          {stage.links.map((link) => <Link key={link.href} className="thera-action secondary" href={link.href}>{link.label}</Link>)}
        </div>
      </div>
      <p className="revenue-cycle-guide-note">This guide explains the workflow. Selecting a stage does not complete work or change a record.</p>
    </details>
  );
}
