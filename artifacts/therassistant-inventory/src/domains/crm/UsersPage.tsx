import { useEffect,useState } from "react";
import { paymentDeskApi } from "./crm-api";
import type { CrmAccess } from "./types";
type UserRow={email:string;display_name:string|null;role:string;active:boolean;must_change_password:boolean};
export function UsersPage({access}:{access:CrmAccess}){
 const [users,setUsers]=useState<UserRow[]>([]); const [email,setEmail]=useState("");const [name,setName]=useState("");const [result,setResult]=useState<string|null>(null);const [error,setError]=useState<string|null>(null);
 const load=()=>paymentDeskApi<{users:UserRow[]}>("users").then(r=>setUsers(r.users)).catch(e=>setError(e instanceof Error?e.message:"Unable to load users."));
 useEffect(()=>{if(access.role==="admin")void load();},[access.role]);
 if(access.role!=="admin")return <div className="crm-alert">Administrator access required.</div>;
 async function add(e:React.FormEvent){e.preventDefault();try{const r=await paymentDeskApi<{email:string;tempPassword:string|null;message:string}>("create-user",{method:"POST",body:{email,displayName:name}});setResult(r.tempPassword?`Temporary password for ${r.email}: ${r.tempPassword}`:r.message);setEmail("");setName("");await load();}catch(err){setError(err instanceof Error?err.message:"Unable to add operator.");}}
 async function toggle(u:UserRow){try{await paymentDeskApi("set-user-active",{method:"POST",body:{email:u.email,active:!u.active}});await load();}catch(err){setError(err instanceof Error?err.message:"Unable to change user access.");}}
 return <section className="crm-stack"><div className="crm-page-head"><div><h1>CRM Users</h1><p>Operator access is shared with Payment Desk.</p></div></div>
 {error&&<div className="crm-alert">{error}</div>}<form className="crm-card crm-inline-form" onSubmit={add}><input required type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)}/><input placeholder="Display name" value={name} onChange={e=>setName(e.target.value)}/><button className="crm-primary">Add Operator</button></form>
 {result&&<div className="crm-alert info">{result}</div>}
 {users.map(u=><div key={u.email} className="crm-card crm-user-row"><div><strong>{u.display_name||u.email}</strong><div className="crm-muted">{u.email} · {u.role}</div></div><button disabled={u.email===access.email} onClick={()=>void toggle(u)}>{u.active?"Disable":"Enable"}</button></div>)}</section>;
}
