drop policy if exists "audit_logs tenant select" on public.audit_logs;
drop policy if exists "audit_logs tenant update" on public.audit_logs;

drop policy if exists "phi_access_logs tenant select" on public.phi_access_logs;
drop policy if exists "phi_access_logs tenant update" on public.phi_access_logs;

drop policy if exists "system_events tenant select" on public.system_events;
drop policy if exists "system_events tenant update" on public.system_events;

drop policy if exists "notifications tenant insert" on public.notifications;
drop policy if exists "notifications tenant select" on public.notifications;
drop policy if exists "notifications tenant update" on public.notifications;
