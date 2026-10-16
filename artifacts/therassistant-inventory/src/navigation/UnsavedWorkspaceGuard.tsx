import { useEffect } from 'react';
import { registerWorkspaceBlocker } from './workspace-guard';
export function UnsavedWorkspaceGuard({dirty,message='Discard unsaved changes?'}:{dirty:boolean;message?:string}) {
 useEffect(()=>{
  if(!dirty)return;
  const remove=registerWorkspaceBlocker(()=>window.confirm(message));
  const unload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
  window.addEventListener('beforeunload',unload);
  return ()=>{remove();window.removeEventListener('beforeunload',unload);};
 },[dirty,message]);
 return null;
}
