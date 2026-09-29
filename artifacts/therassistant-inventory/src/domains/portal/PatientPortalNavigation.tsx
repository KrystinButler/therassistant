import { BookOpenText, CalendarDays, CreditCard, Heart, Home, UserRound } from "lucide-react";
import { Link } from "wouter";

import { PORTAL_HOME, PORTAL_JOURNAL } from "./routes";
import "./patient-portal-nav.css";

export type PatientPortalNavKey = "home" | "appointments" | "journal" | "checkin" | "billing" | "profile";

type Props = {
  active?: PatientPortalNavKey;
  checkInHref?: string;
};

const homeAnchors = {
  appointments: `${PORTAL_HOME}#appointments`,
  billing: `${PORTAL_HOME}#billing`,
  profile: `${PORTAL_HOME}#profile`,
};

export function PatientPortalNavigation({ active, checkInHref }: Props) {
  const items = [
    { key: "home" as const, href: PORTAL_HOME, label: "Home", icon: Home },
    { key: "appointments" as const, href: homeAnchors.appointments, label: "Appointments", icon: CalendarDays },
    { key: "journal" as const, href: PORTAL_JOURNAL, label: "Journal", icon: BookOpenText },
    { key: "checkin" as const, href: checkInHref ?? homeAnchors.appointments, label: "Check-In", icon: Heart },
    { key: "billing" as const, href: homeAnchors.billing, label: "Billing", icon: CreditCard },
    { key: "profile" as const, href: homeAnchors.profile, label: "Profile", icon: UserRound },
  ];

  return (
    <nav className="pj-nav" aria-label="Patient portal navigation">
      {items.map((item) => {
        const Icon = item.icon;
        return <Link key={item.key} href={item.href} className={active === item.key ? "active" : undefined}><Icon size={17} /> {item.label}</Link>;
      })}
    </nav>
  );
}

export function PatientPortalMobileNavigation({ active }: Pick<Props, "active">) {
  const items = [
    { key: "home" as const, href: PORTAL_HOME, label: "Home", icon: Home },
    { key: "appointments" as const, href: homeAnchors.appointments, label: "Visits", icon: CalendarDays },
    { key: "journal" as const, href: PORTAL_JOURNAL, label: "Journal", icon: BookOpenText },
    { key: "billing" as const, href: homeAnchors.billing, label: "Billing", icon: CreditCard },
    { key: "profile" as const, href: homeAnchors.profile, label: "Profile", icon: UserRound },
  ];

  return (
    <nav className="ppn-mobile" aria-label="Patient portal mobile navigation">
      {items.map((item) => {
        const Icon = item.icon;
        return <Link key={item.key} href={item.href} className={active === item.key ? "active" : undefined}><Icon size={19} /><span>{item.label}</span></Link>;
      })}
    </nav>
  );
}
