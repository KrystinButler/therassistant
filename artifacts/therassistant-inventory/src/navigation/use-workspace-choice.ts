import type { SetStateAction } from 'react';
import { useSearch } from 'wouter';
import { workspaceChoice, workspaceQuery } from './workspace-state';

/** Keep filters and selection in navigation state; clinical draft content stays in its editor. */
export function useWorkspaceChoice<T extends string | null>(key:string, fallback:T, choices?:readonly T[]) {
  const search=useSearch();
  const value=workspaceChoice(search,key,fallback,choices);
  function choose(next:SetStateAction<T>) {
    const current=workspaceChoice(window.location.search,key,fallback,choices);
    const resolved=typeof next==='function' ? next(current) : next;
    window.history.replaceState(window.history.state,'',window.location.pathname+workspaceQuery(window.location.search,key,resolved ?? '')+window.location.hash);
  }
  return [value,choose] as const;
}
