import { useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Braces, ChevronDown, ChevronRight, CircleAlert, Clipboard,
  Database, Filter, Hash, LayoutGrid, ListFilter, Loader2, Menu,
  Pencil, Plus, RefreshCw, Search, Server, Settings2, ShieldCheck, Table2, Trash2, X,
} from 'lucide-react';
import {
  getGetInventoryFacetsQueryKey, getGetInventoryQueryKey, getGetInventorySummaryQueryKey,
  getListInventoryQueryKey, InventoryObjectType, type InventoryInput, type InventoryRecord,
  type InventorySummary, type ListInventoryParams, useCreateInventory, useDeleteInventory,
  useGetInventory, useGetInventoryFacets, useGetInventorySummary, useListInventory, useUpdateInventory,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, useLocation, useParams, Link, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();
const objectTypes = Object.values(InventoryObjectType);
const typeLabels: Record<string, string> = {
  TABLE: 'Table', VIEW: 'View', FUNCTION: 'Function', TRIGGER: 'Trigger', ENUM: 'Enum',
  INDEX: 'Index', RLS_POLICY: 'RLS policy', ROLE: 'Role', GRANT: 'Grant',
};
const typeIcons: Record<string, typeof Table2> = {
  TABLE: Table2, VIEW: LayoutGrid, FUNCTION: Braces, TRIGGER: RefreshCw, ENUM: Hash,
  INDEX: ListFilter, RLS_POLICY: ShieldCheck, ROLE: Server, GRANT: Clipboard,
};

function formatNumber(value?: number) {
  return new Intl.NumberFormat('en-US').format(value ?? 0);
}

function formatDate(value?: string) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [location] = useLocation();
  const active = location.startsWith('/inventory/') ? 'inventory' : 'overview';
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[250px] flex-col border-r border-sidebar-border bg-sidebar px-4 py-5 text-sidebar-foreground transition-transform md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between px-2">
          <Link href="/" className="flex items-center gap-3" data-testid="link-brand">
            <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
              <Database size={18} strokeWidth={2.5} />
            </span>
            <span>
              <span className="block text-[13px] font-extrabold tracking-[0.08em] text-sidebar-accent-foreground">NORTHSTAR</span>
              <span className="block font-mono-data text-[9px] uppercase tracking-[0.18em] text-sidebar-foreground/55">data inventory</span>
            </span>
          </Link>
          <button className="rounded-md p-1 text-sidebar-foreground/60 hover:bg-sidebar-accent md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation" data-testid="button-close-navigation"><X size={17} /></button>
        </div>
        <div className="mt-12 px-2 font-mono-data text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/40">Workspace</div>
        <nav className="mt-3 space-y-1" aria-label="Primary navigation">
          <Link href="/" onClick={() => setMobileOpen(false)} className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold ${active === 'overview' ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground'}`} data-testid="link-inventory-overview">
            <LayoutGrid size={17} /><span>Inventory</span>{active === 'overview' && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-sidebar-primary" />}
          </Link>
          <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-sidebar-foreground/30"><Settings2 size={17} /><span>Workspace settings</span><span className="ml-auto font-mono-data text-[9px] uppercase">soon</span></div>
        </nav>
        <div className="mt-auto rounded-xl border border-sidebar-border bg-sidebar-accent/55 p-3.5">
          <div className="flex items-center gap-2 text-[11px] font-bold text-sidebar-accent-foreground"><span className="h-2 w-2 animate-pulse rounded-full bg-sidebar-primary" />Connected</div>
          <p className="mt-2 font-mono-data text-[10px] leading-relaxed text-sidebar-foreground/45">PostgreSQL schema<br />read/write access enabled</p>
        </div>
      </aside>
      {mobileOpen && <button className="fixed inset-0 z-30 bg-sidebar/40 md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu overlay" data-testid="button-close-menu-overlay" />}
      <main className="md:pl-[250px]">
        <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-border/80 bg-background/90 px-5 backdrop-blur-md md:px-9">
          <button className="rounded-md p-2 text-muted-foreground hover:bg-muted md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation" data-testid="button-open-navigation"><Menu size={20} /></button>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex"><span className="font-mono-data text-[10px] uppercase tracking-[0.12em]">Workspace</span><ChevronRight size={13} /><span className="font-semibold text-foreground">{active === 'overview' ? 'Inventory overview' : 'Record detail'}</span></div>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 font-mono-data text-[10px] text-muted-foreground sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-chart-2" />SYNCED 2M AGO</span>
            <div className="grid h-8 w-8 place-items-center rounded-full bg-secondary font-mono-data text-[11px] font-medium text-secondary-foreground">DT</div>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
    <div>
      <div className="font-mono-data text-[10px] uppercase tracking-[0.2em] text-chart-2">{eyebrow}</div>
      <h1 className="mt-2 font-display text-[42px] leading-none tracking-[-0.035em] text-foreground sm:text-[52px]">{title}</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
    {action}
  </div>;
}

function SummaryStrip({ summary, isLoading, isError, onRetry }: { summary?: InventorySummary; isLoading: boolean; isError: boolean; onRetry: () => void }) {
  const cells = [
    ['Objects', summary?.total, 'TOTAL CATALOG'],
    ['Tables', summary?.tables, 'RELATIONAL'],
    ['Views', summary?.views, 'READ MODELS'],
    ['Functions', summary?.functions, 'EXECUTABLE'],
    ['Columns', summary?.totalColumns, 'DOCUMENTED'],
    ['Empty tables', summary?.emptyTables, 'NEEDS REVIEW'],
  ];
  if (isError) return <div className="mt-8 flex items-center justify-between rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive"><span className="flex items-center gap-2"><CircleAlert size={16} />Summary metrics could not be loaded.</span><button className="font-semibold underline" onClick={onRetry} data-testid="button-retry-summary">Retry</button></div>;
  return <div className="mt-9 grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card shadow-sm sm:grid-cols-3 lg:grid-cols-6">
    {cells.map(([label, value, meta], index) => <div className={`stagger-in stagger-in-${Math.min(index + 1, 4)} border-b border-border p-4 last:border-b-0 sm:border-b-0 sm:border-r lg:last:border-r-0 ${index > 3 ? 'sm:border-t lg:border-t-0' : ''}`} key={label as string}>
      <div className="font-mono-data text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{meta as string}</div>
      <div className="mt-2 font-mono-data text-[26px] font-medium tracking-[-0.06em] text-foreground">{isLoading ? <span className="inline-block h-7 w-16 animate-pulse rounded bg-muted" /> : formatNumber(value as number)}</div>
      <div className="mt-1 text-xs font-semibold text-muted-foreground">{label as string}</div>
    </div>)}
  </div>;
}

function TypeBadge({ type }: { type: string }) {
  const Icon = typeIcons[type] ?? Database;
  return <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/60 px-2 py-1 font-mono-data text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground"><Icon size={12} className="text-chart-2" />{typeLabels[type] ?? type}</span>;
}

function RecordRow({ record, onDelete }: { record: InventoryRecord; onDelete: (record: InventoryRecord) => void }) {
  return <div className="group grid grid-cols-[minmax(190px,1.5fr)_100px_minmax(120px,1fr)_90px_90px_34px] items-center gap-3 border-b border-border/80 px-4 py-3.5 transition-colors hover:bg-secondary/35 md:px-5" data-testid={`row-inventory-${record.id}`}>
    <Link href={`/inventory/${record.id}`} className="min-w-0" data-testid={`link-record-${record.id}`}>
      <div className="truncate font-mono-data text-[12px] font-medium text-foreground group-hover:text-chart-2">{record.objectName}</div>
      <div className="mt-1 truncate text-[11px] text-muted-foreground">{record.schemaName || 'schema not specified'}</div>
    </Link>
    <TypeBadge type={record.objectType} />
    <div className="truncate font-mono-data text-[11px] text-muted-foreground">{record.sourceSheet}</div>
    <div className="font-mono-data text-[11px] text-muted-foreground">{record.objectType === 'TABLE' ? formatNumber(record.rowCount) : '—'}</div>
    <div className="font-mono-data text-[11px] text-muted-foreground">{record.objectType === 'TABLE' ? record.columnCount : '—'}</div>
    <div className="flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      <Link href={`/inventory/${record.id}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label={`Edit ${record.objectName}`} data-testid={`button-edit-${record.id}`}><Pencil size={14} /></Link>
      <button className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => onDelete(record)} aria-label={`Delete ${record.objectName}`} data-testid={`button-delete-${record.id}`}><Trash2 size={14} /></button>
    </div>
  </div>;
}

function RecordSkeleton() {
  return <div className="space-y-3 p-5">{[1, 2, 3, 4, 5].map((item) => <div key={item} className="flex items-center gap-4"><div className="h-9 w-9 animate-pulse rounded bg-muted" /><div className="h-9 flex-1 animate-pulse rounded bg-muted" /><div className="h-7 w-24 animate-pulse rounded bg-muted" /></div>)}</div>;
}

function EmptyState({ filtered, onReset, onCreate }: { filtered: boolean; onReset: () => void; onCreate: () => void }) {
  return <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
    <div className="grid h-14 w-14 place-items-center rounded-2xl border border-border bg-secondary text-muted-foreground"><Search size={22} /></div>
    <h3 className="mt-5 text-base font-bold">{filtered ? 'No matching records' : 'Your inventory is empty'}</h3>
    <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{filtered ? 'Try a different search term or clear the active filters.' : 'Start documenting the objects that make your operational database work.'}</p>
    <button className="mt-5 rounded-lg border border-border bg-card px-4 py-2 text-xs font-bold hover:bg-secondary" onClick={filtered ? onReset : onCreate} data-testid={filtered ? 'button-reset-empty' : 'button-create-empty'}>{filtered ? 'Clear filters' : 'Add first record'}</button>
  </div>;
}

function DeleteDialog({ record, onClose, onConfirm, pending }: { record: InventoryRecord | null; onClose: () => void; onConfirm: () => void; pending: boolean }) {
  if (!record) return null;
  return <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/25 p-4 backdrop-blur-sm">
    <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="delete-title">
      <div className="flex items-start justify-between"><div className="grid h-10 w-10 place-items-center rounded-xl bg-destructive/10 text-destructive"><Trash2 size={18} /></div><button className="rounded-md p-1 text-muted-foreground hover:bg-muted" onClick={onClose} aria-label="Close delete dialog" data-testid="button-close-delete"><X size={18} /></button></div>
      <h2 id="delete-title" className="mt-5 text-lg font-bold">Remove this record?</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">You are about to remove <span className="font-mono-data text-foreground">{record.objectName}</span> from the inventory. This action cannot be undone.</p>
      <div className="mt-6 flex justify-end gap-2"><button className="rounded-lg px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted" onClick={onClose} data-testid="button-cancel-delete">Cancel</button><button className="flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-bold text-destructive-foreground hover:opacity-90 disabled:opacity-60" onClick={onConfirm} disabled={pending} data-testid="button-confirm-delete">{pending && <Loader2 size={14} className="animate-spin" />}Remove record</button></div>
    </div>
  </div>;
}

function InventoryForm({ initial, onSubmit, pending, onCancel, submitLabel }: { initial?: InventoryRecord; onSubmit: (data: InventoryInput) => void; pending: boolean; onCancel?: () => void; submitLabel: string }) {
  const [objectType, setObjectType] = useState<string>(initial?.objectType ?? 'TABLE');
  const [objectName, setObjectName] = useState(initial?.objectName ?? '');
  const [sourceSheet, setSourceSheet] = useState(initial?.sourceSheet ?? '');
  const [schemaName, setSchemaName] = useState(initial?.schemaName ?? '');
  const [columnCount, setColumnCount] = useState(String(initial?.columnCount ?? 0));
  const [rowCount, setRowCount] = useState(String(initial?.rowCount ?? 0));
  const [columns, setColumns] = useState(initial?.columns.join(', ') ?? '');
  const [details, setDetails] = useState(Object.entries(initial?.details ?? {}).map(([key, value]) => `${key}: ${value}`).join('\n'));
  const [error, setError] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!objectName.trim() || !sourceSheet.trim()) { setError('Object name and source sheet are required.'); return; }
    const parsedDetails = details.split('\n').reduce<Record<string, string>>((acc, line) => { const divider = line.indexOf(':'); if (divider > 0) acc[line.slice(0, divider).trim()] = line.slice(divider + 1).trim(); return acc; }, {});
    onSubmit({ objectType: objectType as InventoryObjectType, objectName: objectName.trim(), sourceSheet: sourceSheet.trim(), schemaName: schemaName.trim() || undefined, columnCount: Math.max(0, Number(columnCount) || 0), rowCount: Math.max(0, Number(rowCount) || 0), columns: columns.split(',').map((column) => column.trim()).filter(Boolean), details: parsedDetails });
  }
  const fieldClass = "mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-chart-2 focus:ring-2 focus:ring-chart-2/15";
  return <form onSubmit={submit} className="space-y-5">
    {error && <div className="flex items-center gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-xs font-semibold text-destructive"><CircleAlert size={15} />{error}</div>}
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-xs font-bold">Object name<input value={objectName} onChange={(event) => setObjectName(event.target.value)} placeholder="e.g. claims_encounters" className={fieldClass} autoFocus data-testid="input-object-name" /></label>
      <label className="text-xs font-bold">Object type<select value={objectType} onChange={(event) => setObjectType(event.target.value)} className={fieldClass} data-testid="select-object-type">{objectTypes.map((type) => <option key={type} value={type}>{typeLabels[type]}</option>)}</select></label>
      <label className="text-xs font-bold">Source sheet<input value={sourceSheet} onChange={(event) => setSourceSheet(event.target.value)} placeholder="e.g. Core schema" className={fieldClass} data-testid="input-source-sheet" /></label>
      <label className="text-xs font-bold">Schema name<input value={schemaName} onChange={(event) => setSchemaName(event.target.value)} placeholder="public" className={fieldClass} data-testid="input-schema-name" /></label>
      <label className="text-xs font-bold">Column count<input type="number" min="0" value={columnCount} onChange={(event) => setColumnCount(event.target.value)} className={fieldClass} data-testid="input-column-count" /></label>
      <label className="text-xs font-bold">Row count<input type="number" min="0" value={rowCount} onChange={(event) => setRowCount(event.target.value)} className={fieldClass} data-testid="input-row-count" /></label>
    </div>
    <label className="block text-xs font-bold">Columns<span className="mt-1.5 block text-[11px] font-normal text-muted-foreground">Comma-separated column names</span><input value={columns} onChange={(event) => setColumns(event.target.value)} placeholder="member_id, effective_date, status" className={fieldClass} data-testid="input-columns" /></label>
    <label className="block text-xs font-bold">Details<span className="mt-1.5 block text-[11px] font-normal text-muted-foreground">One key: value pair per line</span><textarea value={details} onChange={(event) => setDetails(event.target.value)} placeholder={'owner: data platform\npurpose: claims reporting'} rows={4} className={`${fieldClass} resize-y`} data-testid="textarea-details" /></label>
    <div className="flex justify-end gap-2 border-t border-border pt-4">{onCancel && <button type="button" className="rounded-lg px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted" onClick={onCancel} data-testid="button-cancel-form">Cancel</button>}<button type="submit" disabled={pending} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-60" data-testid="button-submit-form">{pending && <Loader2 size={14} className="animate-spin" />}{submitLabel}</button></div>
  </form>;
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const create = useCreateInventory();
  function submit(data: InventoryInput) {
    create.mutate({ data }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListInventoryQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetInventorySummaryQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetInventoryFacetsQueryKey() }); onClose(); } });
  }
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-foreground/25 p-4 backdrop-blur-sm"><div className="mx-auto my-8 w-full max-w-2xl rounded-2xl border border-border bg-card p-5 shadow-2xl sm:p-7"><div className="mb-6 flex items-start justify-between"><div><div className="font-mono-data text-[10px] uppercase tracking-[0.18em] text-chart-2">New catalog record</div><h2 className="mt-2 text-xl font-bold">Add to inventory</h2><p className="mt-1 text-sm text-muted-foreground">Capture enough context for the next engineer to find their way.</p></div><button className="rounded-md p-1 text-muted-foreground hover:bg-muted" onClick={onClose} aria-label="Close create dialog" data-testid="button-close-create"><X size={18} /></button></div><InventoryForm onSubmit={submit} pending={create.isPending} onCancel={onClose} submitLabel="Create record" /></div></div>;
}

function Overview() {
  const [search, setSearch] = useState('');
  const [objectType, setObjectType] = useState('');
  const [sourceSheet, setSourceSheet] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [deleteRecord, setDeleteRecord] = useState<InventoryRecord | null>(null);
  const queryClient = useQueryClient();
  const facets = useGetInventoryFacets();
  const summary = useGetInventorySummary();
  const params = useMemo<ListInventoryParams>(() => ({ search: search.trim() || undefined, objectType: (objectType || undefined) as ListInventoryParams['objectType'], sourceSheet: sourceSheet || undefined, limit: 1000, offset: 0 }), [search, objectType, sourceSheet]);
  const list = useListInventory(params);
  const remove = useDeleteInventory();
  const hasFilters = Boolean(search || objectType || sourceSheet);
  function resetFilters() { setSearch(''); setObjectType(''); setSourceSheet(''); }
  function confirmDelete() { if (!deleteRecord) return; remove.mutate({ id: deleteRecord.id }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListInventoryQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetInventorySummaryQueryKey() }); setDeleteRecord(null); } }); }
  const records = list.data ?? [];
  return <div className="mx-auto max-w-[1500px] px-5 py-9 md:px-9 md:py-12">
    <PageHeading eyebrow="Database observatory / 01" title="Inventory" description="A living index of the objects, relationships, and rules that keep operations moving." action={<button onClick={() => setShowCreate(true)} className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-sm hover:opacity-90" data-testid="button-open-create"><Plus size={16} /> Add record</button>} />
    <SummaryStrip summary={summary.data} isLoading={summary.isLoading} isError={summary.isError} onRetry={() => summary.refetch()} />
    <section className="mt-10" aria-labelledby="catalog-heading">
      <div className="flex flex-col justify-between gap-4 border-b border-border pb-4 md:flex-row md:items-end"><div><div className="flex items-center gap-2"><h2 id="catalog-heading" className="text-lg font-bold">Catalog</h2><span className="rounded-full bg-secondary px-2 py-0.5 font-mono-data text-[10px] text-muted-foreground">{list.isLoading ? '…' : formatNumber(records.length)}</span></div><p className="mt-1 text-xs text-muted-foreground">Search across names, schemas, and source sheets.</p></div><div className="flex items-center gap-2 font-mono-data text-[10px] uppercase tracking-[0.12em] text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-chart-1" />Live index</div></div>
      <div className="mt-4 flex flex-col gap-2 md:flex-row">
        <div className="relative min-w-0 flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search object names…" className="h-10 w-full rounded-lg border border-input bg-card pl-9 pr-9 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-chart-2 focus:ring-2 focus:ring-chart-2/15" data-testid="input-search-inventory" />{search && <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => setSearch('')} aria-label="Clear search" data-testid="button-clear-search"><X size={14} /></button>}</div>
        <div className="relative"><Filter size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><select value={objectType} onChange={(event) => setObjectType(event.target.value)} className="h-10 w-full appearance-none rounded-lg border border-input bg-card pl-9 pr-9 text-xs font-semibold outline-none focus:border-chart-2 md:w-44" data-testid="select-filter-type"><option value="">All object types</option>{(facets.data?.objectTypes ?? objectTypes).map((type) => <option key={type} value={type}>{typeLabels[type] ?? type}</option>)}</select><ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" /></div>
        <div className="relative"><select value={sourceSheet} onChange={(event) => setSourceSheet(event.target.value)} className="h-10 w-full appearance-none rounded-lg border border-input bg-card px-3 pr-9 text-xs font-semibold outline-none focus:border-chart-2 md:w-48" data-testid="select-filter-source"><option value="">All source sheets</option>{(facets.data?.sourceSheets ?? []).map((sheet) => <option key={sheet} value={sheet}>{sheet}</option>)}</select><ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" /></div>
        {hasFilters && <button onClick={resetFilters} className="h-10 rounded-lg border border-border px-3 text-xs font-bold text-muted-foreground hover:bg-secondary" data-testid="button-clear-filters">Clear</button>}
      </div>
      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="hidden grid-cols-[minmax(190px,1.5fr)_100px_minmax(120px,1fr)_90px_90px_34px] gap-3 border-b border-border bg-secondary/45 px-5 py-2.5 font-mono-data text-[9px] uppercase tracking-[0.14em] text-muted-foreground md:grid"><span>Object</span><span>Type</span><span>Source</span><span>Rows</span><span>Columns</span><span /></div>
        {list.isLoading ? <RecordSkeleton /> : list.isError ? <div className="flex flex-col items-center px-6 py-16 text-center"><CircleAlert size={22} className="text-destructive" /><h3 className="mt-4 font-bold">Catalog unavailable</h3><p className="mt-1 text-sm text-muted-foreground">We could not reach the inventory service.</p><button onClick={() => list.refetch()} className="mt-4 flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-bold hover:bg-secondary" data-testid="button-retry-list"><RefreshCw size={14} /> Try again</button></div> : records.length === 0 ? <EmptyState filtered={hasFilters} onReset={resetFilters} onCreate={() => setShowCreate(true)} /> : records.map((record) => <RecordRow key={record.id} record={record} onDelete={setDeleteRecord} />)}
      </div>
    </section>
    <DeleteDialog record={deleteRecord} onClose={() => setDeleteRecord(null)} onConfirm={confirmDelete} pending={remove.isPending} />
    {showCreate && <CreateDialog onClose={() => setShowCreate(false)} />}
  </div>;
}

function Detail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const record = useGetInventory(id, { query: { queryKey: getGetInventoryQueryKey(id), enabled: Number.isFinite(id) } });
  const update = useUpdateInventory();
  const remove = useDeleteInventory();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  function save(data: InventoryInput) {
    update.mutate({ id, data }, { onSuccess: (saved) => { queryClient.setQueryData(getGetInventoryQueryKey(id), saved); queryClient.invalidateQueries({ queryKey: getListInventoryQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetInventorySummaryQueryKey() }); setEditing(false); } });
  }
  function deleteRecord() {
    remove.mutate({ id }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListInventoryQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetInventorySummaryQueryKey() }); setLocation('/'); } });
  }
  if (record.isLoading) return <div className="mx-auto max-w-[1200px] px-5 py-12 md:px-9"><div className="h-5 w-28 animate-pulse rounded bg-muted" /><div className="mt-7 h-12 w-2/3 animate-pulse rounded bg-muted" /><div className="mt-10 h-64 animate-pulse rounded-xl bg-muted" /></div>;
  if (record.isError || !record.data) return <div className="mx-auto max-w-[900px] px-5 py-16 text-center md:px-9"><CircleAlert className="mx-auto text-destructive" /><h1 className="mt-4 text-xl font-bold">Record not found</h1><p className="mt-2 text-sm text-muted-foreground">This catalog record may have been removed or is temporarily unavailable.</p><Link href="/" className="mt-5 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-bold hover:bg-secondary" data-testid="link-back-not-found"><ArrowLeft size={15} /> Back to inventory</Link></div>;
  const item = record.data;
  return <div className="mx-auto max-w-[1200px] px-5 py-9 md:px-9 md:py-12">
    <Link href="/" className="inline-flex items-center gap-2 font-mono-data text-[10px] uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground" data-testid="link-back-inventory"><ArrowLeft size={14} /> Inventory</Link>
    <div className="mt-8 flex flex-col justify-between gap-5 border-b border-border pb-7 md:flex-row md:items-end"><div><div className="flex items-center gap-3"><TypeBadge type={item.objectType} /><span className="font-mono-data text-[10px] text-muted-foreground">ID {String(item.id).padStart(4, '0')}</span></div><h1 className="mt-4 break-all font-display text-[38px] leading-none tracking-[-0.035em] sm:text-[54px]" data-testid="text-detail-object-name">{item.objectName}</h1><p className="mt-3 flex items-center gap-2 font-mono-data text-[11px] text-muted-foreground"><span>{item.schemaName || 'schema not specified'}</span><span className="text-border">/</span><span>{item.sourceSheet}</span></p></div><div className="flex gap-2"><button onClick={() => setConfirming(true)} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-bold text-destructive hover:bg-destructive/5" data-testid="button-delete-detail"><Trash2 size={14} /> Delete</button><button onClick={() => setEditing(!editing)} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:opacity-90" data-testid="button-edit-detail"><Pencil size={14} /> {editing ? 'Close editor' : 'Edit record'}</button></div></div>
    {editing ? <div className="mt-7 max-w-3xl rounded-xl border border-border bg-card p-5 shadow-sm sm:p-7"><div className="mb-6"><div className="font-mono-data text-[10px] uppercase tracking-[0.18em] text-chart-2">Editing record</div><h2 className="mt-2 text-lg font-bold">Keep the catalog current</h2></div><InventoryForm initial={item} onSubmit={save} pending={update.isPending} onCancel={() => setEditing(false)} submitLabel="Save changes" /></div> : <DetailContent item={item} />}
    {confirming && <DeleteDialog record={item} onClose={() => setConfirming(false)} onConfirm={deleteRecord} pending={remove.isPending} />}
  </div>;
}

function DetailContent({ item }: { item: InventoryRecord }) {
  return <div className="mt-8 grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
    <section className="rounded-xl border border-border bg-card shadow-sm"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="text-sm font-bold">Structure</h2><p className="mt-1 text-xs text-muted-foreground">Documented columns in this object.</p></div><span className="font-mono-data text-xs text-muted-foreground">{item.columnCount} cols</span></div>{item.columns.length ? <div className="divide-y divide-border/70">{item.columns.map((column, index) => <div className="flex items-center gap-4 px-5 py-3" key={`${column}-${index}`} data-testid={`text-column-${index}`}><span className="w-6 font-mono-data text-[10px] text-muted-foreground/60">{String(index + 1).padStart(2, '0')}</span><span className="font-mono-data text-xs text-foreground">{column}</span></div>)}</div> : <div className="px-5 py-10 text-center text-sm text-muted-foreground">No column names have been documented.</div>}</section>
    <div className="space-y-5"><section className="rounded-xl border border-border bg-card p-5 shadow-sm"><h2 className="text-sm font-bold">At a glance</h2><div className="mt-4 grid grid-cols-2 gap-3">{[['Rows', formatNumber(item.rowCount)], ['Columns', formatNumber(item.columnCount)], ['Created', formatDate(item.createdAt)], ['Updated', formatDate(item.updatedAt)]].map(([label, value]) => <div className="rounded-lg bg-secondary/65 p-3" key={label}><div className="font-mono-data text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div><div className="mt-2 break-words font-mono-data text-xs font-medium">{value}</div></div>)}</div></section><section className="rounded-xl border border-border bg-card p-5 shadow-sm"><h2 className="text-sm font-bold">Context</h2>{Object.keys(item.details).length ? <dl className="mt-4 space-y-3">{Object.entries(item.details).map(([key, value]) => <div className="flex justify-between gap-5 border-b border-border/70 pb-3 last:border-0 last:pb-0" key={key}><dt className="font-mono-data text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{key}</dt><dd className="text-right text-xs font-semibold">{value}</dd></div>)}</dl> : <p className="mt-3 text-sm text-muted-foreground">No additional context has been added.</p>}</section></div>
  </div>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><AppShell><Switch><Route path="/" component={Overview} /><Route path="/inventory/:id" component={Detail} /><Route component={NotFound} /></Switch></AppShell></ErrorBoundary>;
}

function NotFound() {
  return <div className="mx-auto max-w-lg px-5 py-24 text-center"><div className="font-mono-data text-xs uppercase tracking-[0.2em] text-chart-2">404 / off the index</div><h1 className="mt-4 font-display text-5xl">Nothing here.</h1><p className="mt-3 text-sm text-muted-foreground">That route is not part of this workspace.</p><Link href="/" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground" data-testid="link-return-home"><ArrowLeft size={15} /> Return to inventory</Link></div>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;