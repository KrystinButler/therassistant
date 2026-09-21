import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "../../auth/auth-context";
import type { CrmAccess } from "./types";
import "./crm.css";

function NavLink({href,label}:{href:string;label:string}) {
  const [location]=useLocation();
  const active=location===href || (href!=="/crm" && location.startsWith(href+"/"));
  return <Link href={href} className={"crm-nav-link"+(active?" active":"")}>{label}</Link>;
}

export function CrmShell({access,children}:{access:CrmAccess;children:ReactNode}) {
  const { signOut }=useAuth();
  return <div className="crm-app">
    <header className="crm-header">
      <div><strong>THERASSISTANT</strong><span> CRM</span></div>
      <div className="crm-user"><span>{access.displayName}</span><button type="button" onClick={()=>void signOut()}>Sign out</button></div>
    </header>
    <nav className="crm-nav" aria-label="CRM">
      <NavLink href="/crm" label="Accounts"/>
      <NavLink href="/crm/follow-ups" label="Follow-Ups"/>
      <a className="crm-nav-link" href="/payment-desk">Payments</a>
      {access.role==="admin" && <NavLink href="/crm/users" label="Users"/>}
    </nav>
    <main className="crm-main">{children}</main>
  </div>;
}
