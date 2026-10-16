export function workspaceChoice<T extends string | null>(search:string, key:string, fallback:T, choices?:readonly T[]): T {
  const value=new URLSearchParams(search).get(key);
  return value !== null && (!choices || choices.includes(value as T)) ? value as T : fallback;
}
export function workspaceQuery(search:string,key:string,value:string):string {
  const params=new URLSearchParams(search);
  if(value) params.set(key,value); else params.delete(key);
  return params.size ? `?${params.toString()}` : '';
}

export function workspacePattern(path:string): 'documentation' | 'queue' | 'configuration' | 'record' {
 if (/^\/encounters\//.test(path)) return 'documentation';
 if (/^\/(administration|organization-setup|providers|credentialing|portal-module)(\/|$)/.test(path)) return 'configuration';
 if (/^\/(clients|claims)\/[^/]+/.test(path)) return 'record';
 return 'queue';
}

export function canLeaveWorkspace(dirty:boolean, confirmDiscard:()=>boolean):boolean { return !dirty || confirmDiscard(); }
