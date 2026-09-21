import { useEffect, useState } from "react";
import { Route, Switch } from "wouter";
import { LoginPage } from "../../auth/LoginPage";
import { PasswordRecoveryPage } from "../../auth/PasswordRecoveryPage";
import { useAuth } from "../../auth/auth-context";
import { crmApi } from "./crm-api";
import { CrmShell } from "./CrmShell";
import { AccountsPage } from "./AccountsPage";
import { AccountDetailPage } from "./AccountDetailPage";
import { FollowUpsPage } from "./FollowUpsPage";
import { UsersPage } from "./UsersPage";
import type { CrmAccess } from "./types";

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
      <Route path="/crm/accounts/:id"><AccountDetailPage /></Route>
      <Route path="/crm/follow-ups"><FollowUpsPage /></Route>
      <Route path="/crm/users"><UsersPage access={access} /></Route>
      <Route path="/crm"><AccountsPage access={access} /></Route>
      <Route><div className="thera-state">CRM page not found.</div></Route>
    </Switch>
  </CrmShell>;
}
