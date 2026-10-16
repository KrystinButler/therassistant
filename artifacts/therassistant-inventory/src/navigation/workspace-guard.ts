const blockers = new Set<() => boolean>();
let permitted = 0;
export function registerWorkspaceBlocker(blocker: () => boolean) { blockers.add(blocker); return () => { blockers.delete(blocker); }; }
export function allowWorkspaceNavigation<T>(action: () => T): T { permitted++; try { return action(); } finally { permitted--; } }
export function approveWorkspaceNavigation(): boolean { return permitted > 0 || [...blockers].every(blocker => blocker()); }

export function workspaceLocationChanged(current:string, next:string):boolean {
 const before=new URL(current); const after=new URL(next);
 return before.origin!==after.origin || before.pathname!==after.pathname || before.search!==after.search;
}

/** Run before the router's popstate subscribers; rejected traversal is restored silently. */
export function installWorkspaceNavigationGuard(target: Window) {
  const history = target.history;
  const push = history.pushState;
  const replace = history.replaceState;
  const marker = '__theraWorkspaceIndex';
  let index = Number(history.state?.[marker] ?? 0);
  let currentUrl = target.location.href;
  let currentState = history.state;
  let restoring = false;
  const indexed = (state: unknown, nextIndex: number) => ({ ...(state && typeof state === 'object' ? state : {}), [marker]: nextIndex });
  replace.call(history, indexed(currentState, index), '', currentUrl);
  currentState = history.state;
  const destination = (url?: string | URL | null) => url == null ? target.location.href : new URL(String(url), target.location.href).href;
  history.pushState = function(state, unused, url) {
    const next = destination(url);
    if (workspaceLocationChanged(currentUrl, next) && !approveWorkspaceNavigation()) return;
    push.call(history, indexed(state, index + 1), unused, url);
    index++; currentUrl = target.location.href; currentState = history.state;
  };
  history.replaceState = function(state, unused, url) {
    const next = destination(url);
    if (workspaceLocationChanged(currentUrl, next) && !approveWorkspaceNavigation()) return;
    replace.call(history, indexed(state, index), unused, url);
    currentUrl = target.location.href; currentState = history.state;
  };
  const pop = (event: PopStateEvent) => {
    if (restoring) { restoring = false; event.stopImmediatePropagation(); return; }
    const nextIndex = event.state?.[marker];
    if (workspaceLocationChanged(currentUrl, target.location.href) && !approveWorkspaceNavigation()) {
      event.stopImmediatePropagation();
      if (typeof nextIndex === 'number' && nextIndex !== index) { restoring = true; history.go(index - nextIndex); }
      else { push.call(history, indexed(currentState, index), '', currentUrl); }
      return;
    }
    index = typeof nextIndex === 'number' ? nextIndex : index - 1;
    currentUrl = target.location.href; currentState = history.state;
  };
  const hash = (event: HashChangeEvent) => { if (restoring) event.stopImmediatePropagation(); };
  target.addEventListener('popstate', pop, true);
  target.addEventListener('hashchange', hash, true);
  return () => { history.pushState = push; history.replaceState = replace; target.removeEventListener('popstate', pop, true); target.removeEventListener('hashchange', hash, true); };
}
