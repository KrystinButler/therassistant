import { useEffect, useState } from "react";
import { Route, Switch } from "wouter";
import { LoginPage } from "../../auth/LoginPage";
import { PasswordRecoveryPage } from "../../auth/PasswordRecoveryPage";
import { useAuth } from "../../auth/auth-context";
import { crmApi } from "./crm-api";
import { CrmShell } from "./CrmShell";
import type { CrmAccess } from "./types";

function Placeholder({title}:{title:string}) {
  return <section className="crm-card"><h1>{title}</h1><p>CRM workspace is loading its account tools.</p></section>;
}

export function CrmGate() {
  const {session,loading,passwordRecovery}=useAuth();
  const [access,setAccess]=useState<CrmAccess|null>(null);
  const [checking,setChecking]=useState(false);
  const [error,setError]=useState<string|null>(null);

  useEffect(()=>{
    let active=true;
    if (!session) { setAccess(null); setError(null); return; }
    setChecking(true);
    void crmApi<{user:CrmAccess}>("me")
      .then((result)=>{ if(active){setAccess(result.user);setError(null);} })
      .catch((err)=>{ if(active){setAccess(null);setError(err instanceof Error?err.message:"Unable to verify CRM access.");} })
      .finally(()=>{ if(active)setChecking(false); });
    return ()=>{active=false;};
  },[session?.access_token]);

  if (loading) return <div className="thera-state">Checking session...</div>;
  if (!session) return <LoginPage/>;
  if (passwordRecovery) return <PasswordRecoveryPage/>;
  if (checking) return <div className="thera-state">Loading CRM...</div>;
  if (error || !access) return <div className="thera-state error">{error ?? "CRM access is not available."}</div>;

  return <CrmShell access={access}>
    <Switch>
      <Route path="/crm/accounts/:id"><Placeholder title="Collection Account"/></Route>
      <Route path="/crm/follow-ups"><Placeholder title="Follow-Ups"/></Route>
      <Route path="/crm/users"><Placeholder title="CRM Users"/></Route>
      <Route path="/crm"><Placeholder title="Collection Accounts"/></Route>
      <Route><div className="thera-state">CRM page not found.</div></Route>
    </Switch>
  </CrmShell>;
}
