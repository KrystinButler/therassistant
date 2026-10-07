import { BookOpenText, CalendarDays, CreditCard, Heart, Home, MessageSquare, UserRound } from "lucide-react";
import { Link } from "wouter";

import { PORTAL_HOME, PORTAL_JOURNAL } from "./routes";
import "./patient-portal-nav.css";

export type PatientPortalNavKey = "home" | "appointments" | "journal" | "checkin" | "messages" | "billing" | "profile";

type Props = {
  active?: PatientPortalNavKey;
  checkInHref?: string;
};

const homeAnchors = {
  appointments: `${PORTAL_HOME}#appointments`,
  messages: `${PORTAL_HOME}#messages`,
  billing: `${PORTAL_HOME}#billing`,
  profile: `${PORTAL_HOME}#profile`,
};

export function PatientPortalNavigation({ active, checkInHref }: Props) {
  const items = [
    { key: "home" as const, href: PORTAL_HOME, label: "Home", icon: Home },
    { key: "appointments" as const, href: homeAnchors.appointments, label: "Appointments", icon: CalendarDays },
    { key: "journal" as const, href: PORTAL_JOURNAL, label: "Journal", icon: BookOpenText },
    { key: "checkin" as const, href: checkInHref ?? homeAnchors.appointments, label: "Check-In", icon: Heart },
    { key: "messages" as const, href: homeAnchors.messages, label: "Messages", icon: MessageSquare },
    { key: "billing" as const, href: homeAnchors.billing, label: "Billing", icon: CreditCard },
    { key: "profile" as const, href: homeAnchors.profile, label: "Profile", icon: UserRound },
  ];

  return (
    <nav className="pj-nav" aria-label="Patient portal navigation">
      {items.map((item) => {
        const Icon = item.icon;
        return <a key={item.key} href={item.href} className={active === item.key ? "active" : undefined}><Icon size={17} /> {item.label}</a>;
      })}
    </nav>
  );
}

export function PatientPortalMobileNavigation({ active }: Pick<Props, "active">) {
  const items = [
    { key: "home" as const, href: PORTAL_HOME, label: "Home", icon: Home },
    { key: "appointments" as const, href: homeAnchors.appointments, label: "Visits", icon: CalendarDays },
    { key: "journal" as const, href: PORTAL_JOURNAL, label: "Journal", icon: BookOpenText },
    { key: "messages" as const, href: homeAnchors.messages, label: "Messages", icon: MessageSquare },
    { key: "billing" as const, href: homeAnchors.billing, label: "Billing", icon: CreditCard },
    { key: "profile" as const, href: homeAnchors.profile, label: "Profile", icon: UserRound },
  ];

  return (
    <nav className="ppn-mobile" aria-label="Patient portal mobile navigation">
      {items.map((item) => {
        const Icon = item.icon;
        return <a key={item.key} href={item.href} className={active === item.key ? "active" : undefined}><Icon size={19} /><span>{item.label}</span></a>;
      })}
    </nav>
  );
}
