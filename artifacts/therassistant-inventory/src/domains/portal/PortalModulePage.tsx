import { Link } from "wouter";
import { PORTAL_LOGIN } from "./routes";
export function PortalModulePage() {
  return <><div className="thera-page-header"><h1>Patient Portal</h1><p>Manage patient engagement separately from the clinical workspace.</p></div><div className="thera-filter-row"><Link className="thera-action" href="/messaging">Secure Messages</Link><Link className="thera-action secondary" href="/journal">Shared Journals</Link><Link className="thera-action secondary" href="/portal-preview">Preview Portal</Link><a className="thera-action secondary" href={PORTAL_LOGIN} target="_blank" rel="noreferrer">Patient Login</a></div></>;
}
