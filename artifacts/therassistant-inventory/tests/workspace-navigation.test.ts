import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceChoice, workspaceQuery } from '../src/navigation/workspace-state.ts';

test('workspace filters restore only recognized queues',()=>{
 assert.equal(workspaceChoice('?tab=unapplied','tab','insurance',['insurance','unapplied']),'unapplied');
 assert.equal(workspaceChoice('?tab=invalid','tab','insurance',['insurance','unapplied']),'insurance');
});
test('changing a filter preserves other workspace context and removes empty selection',()=>{
 assert.equal(workspaceQuery('?payer=one&tab=ready','tab','blocked'),'?payer=one&tab=blocked');
 assert.equal(workspaceQuery('?payer=one&claim=old','claim',''),'?payer=one');
});

test('existing routes receive their task layout without changing navigation destinations',async()=>{
 const {workspacePattern}=await import('../src/navigation/workspace-state.ts');
 assert.equal(workspacePattern('/encounters/one'),'documentation');
 assert.equal(workspacePattern('/clients/one'),'record');
 assert.equal(workspacePattern('/claims/one'),'record');
 assert.equal(workspacePattern('/payments'),'queue');
 assert.equal(workspacePattern('/administration/practices'),'configuration');
});

test('navigation retains a dirty draft when discard is declined',async()=>{
 const actions=await import('../src/navigation/workspace-state.ts');
 assert.equal(typeof actions.canLeaveWorkspace,'function');
 let prompts=0;
 assert.equal(actions.canLeaveWorkspace(true,()=>{prompts++;return false;}),false);
 assert.equal(prompts,1);
 assert.equal(actions.canLeaveWorkspace(false,()=>{assert.fail('clean navigation must not prompt');}),true);
});

test('programmatic navigation respects an unsaved workspace and explicit discard applies once',async()=>{
 const {registerWorkspaceBlocker,approveWorkspaceNavigation,allowWorkspaceNavigation}=await import('../src/navigation/workspace-guard.ts');
 let prompts=0;
 const unregister=registerWorkspaceBlocker(()=>{prompts++;return false;});
 assert.equal(approveWorkspaceNavigation(),false);
 assert.equal(allowWorkspaceNavigation(()=>approveWorkspaceNavigation()),true);
 assert.equal(prompts,1);
 unregister();
 assert.equal(approveWorkspaceNavigation(),true);
});

test('history guard blocks programmatic routes and restores rejected Back before router notification',async()=>{
 const {installWorkspaceNavigationGuard,registerWorkspaceBlocker}=await import('../src/navigation/workspace-guard.ts');
 const listeners=new Map<string,Function>();
 const entries:Array<{url:string;state:any}>=[{url:'https://ehr.test/claims',state:null}]; let at=0;let stopped=false;
 const location={get href(){return entries[at].url;}};
 const history={get state(){return entries[at].state;},pushState(state:any,_:string,url:any){entries.splice(at+1);entries.push({state,url:new URL(url,location.href).href});at++;},replaceState(state:any,_:string,url:any){entries[at]={state,url:new URL(url,location.href).href};},go(delta:number){at+=delta;listeners.get('popstate')?.({state:history.state,stopImmediatePropagation(){stopped=true;}});}};
 const target={history,location,addEventListener(name:string,fn:Function){listeners.set(name,fn);},removeEventListener(name:string){listeners.delete(name);}};
 const dispose=installWorkspaceNavigationGuard(target as unknown as Window);
 history.pushState(null,'','/eligibility');
 const unblock=registerWorkspaceBlocker(()=>false);
 history.pushState(null,'','/clients');
 assert.equal(location.href,'https://ehr.test/eligibility');
 history.go(-1);
 assert.equal(location.href,'https://ehr.test/eligibility');
 assert.equal(stopped,true);
 unblock();dispose();
});

test('rejected Back with an encounter fragment cannot notify the router through hashchange',async()=>{
 const {installWorkspaceNavigationGuard,registerWorkspaceBlocker}=await import('../src/navigation/workspace-guard.ts');
 const listeners=new Map<string,Function>();const routes:string[]=[];const pending:Array<()=>void>=[];
 const entries=[{url:'https://ehr.test/encounters/one#encounter-progress-note-editor',state:null as any}];let at=0;
 const location={get href(){return entries[at].url;}};
 const emit=(type:string)=>{let stopped=false;listeners.get(type)?.({state:history.state,stopImmediatePropagation(){stopped=true;}});if(!stopped)routes.push(location.href);};
 const history={get state(){return entries[at].state;},pushState(state:any,_:string,url:any){entries.splice(at+1);entries.push({state,url:new URL(url,location.href).href});at++;},replaceState(state:any,_:string,url:any){entries[at]={state,url:new URL(url,location.href).href};},go(delta:number){pending.push(()=>{at+=delta;emit('popstate');emit('hashchange');});}};
 const target={history,location,addEventListener(name:string,fn:Function){listeners.set(name,fn);},removeEventListener(name:string){listeners.delete(name);}};
 const dispose=installWorkspaceNavigationGuard(target as unknown as Window);
 history.pushState(null,'','/eligibility');const unblock=registerWorkspaceBlocker(()=>false);
 history.go(-1);pending.shift()!();
 assert.deepEqual(routes,[],'rejected traversal must not notify the router while restoration is pending');
 pending.shift()!();
 assert.equal(location.href,'https://ehr.test/eligibility');
 assert.ok(routes.every(url=>url==='https://ehr.test/eligibility'));
 unblock();dispose();
});

test('jumping between sections in the same note does not ask to discard the draft',async()=>{
 const {workspaceLocationChanged}=await import('../src/navigation/workspace-guard.ts');
 assert.equal(workspaceLocationChanged('https://ehr.test/encounters/one','https://ehr.test/encounters/one#encounter-progress-note-editor'),false);
 assert.equal(workspaceLocationChanged('https://ehr.test/encounters/one','https://ehr.test/encounters/two'),true);
});
