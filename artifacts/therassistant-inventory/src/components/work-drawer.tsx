import { registerWorkspaceBlocker, allowWorkspaceNavigation } from "../navigation/workspace-guard";
import { canLeaveWorkspace } from "../navigation/workspace-state";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";
import "./work-drawer.css";

export type WorkDrawerProps = {
  open: boolean;
  docked?: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onPrevious?: () => void;
  onNext?: () => void;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
  openFullRecord?: () => void;
  openFullRecordLabel?: string;
  queuePosition?: ReactNode;
  dirty?: boolean;
  confirmDiscard?: () => boolean;
};

export function WorkDrawer({
  open,
  docked = false,
  onOpenChange,
  title,
  subtitle,
  badges,
  children,
  footer,
  onPrevious,
  onNext,
  previousDisabled,
  nextDisabled,
  openFullRecord,
  openFullRecordLabel = "Open Full Record",
  queuePosition,
  dirty = false,
  confirmDiscard = () => window.confirm("Discard unsaved changes?"),
}: WorkDrawerProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1360px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1360px)");
    const change = () => setWide(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!open || !docked || !wide) return;
    const trigger = document.activeElement as HTMLElement | null;
    panelRef.current?.focus({ preventScroll: true });
    return () => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, [open, docked, wide]);
  useEffect(() => {
    if (!open || !dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const unregister = registerWorkspaceBlocker(confirmDiscard);
    window.addEventListener("beforeunload", unload);
    return () => { unregister(); window.removeEventListener("beforeunload", unload); };
  }, [open, dirty, confirmDiscard]);
  useEffect(() => {
    if (!open || !docked || !wide || !dirty) return;
    const queue = panelRef.current?.parentElement?.querySelector<HTMLElement>(".queue-review-main");
    const wasInert = queue?.inert ?? false;
    if (queue) queue.inert = true;
    return () => { if (queue) queue.inert = wasInert; };
  }, [open, docked, wide, dirty, confirmDiscard]);
  function requestNavigation(action: () => void) { if (canLeaveWorkspace(dirty, confirmDiscard)) allowWorkspaceNavigation(action); }
  function requestOpenChange(nextOpen: boolean) {
    if (!nextOpen && !canLeaveWorkspace(dirty, confirmDiscard)) return;
    onOpenChange(nextOpen);
  }

  if (docked && wide) {
    if (!open) return null;
    return <aside ref={panelRef} tabIndex={-1} className="workspace-review-panel" aria-labelledby={titleId} onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented) { event.stopPropagation(); requestOpenChange(false); } }}>
      <header className="thera-work-drawer-header">
        <div className="thera-work-drawer-heading-row"><div><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" className="thera-action secondary" aria-label="Close record details" onClick={() => requestOpenChange(false)}>Close</button></div>
        {badges && <div className="thera-work-drawer-badges">{badges}</div>}
        <div className="thera-work-drawer-toolbar"><span>{queuePosition}</span><div className="thera-work-drawer-toolbar-actions">
          {onPrevious && <button type="button" className="thera-action secondary" onClick={() => requestNavigation(onPrevious)} disabled={previousDisabled}>Previous</button>}
          {onNext && <button type="button" className="thera-action secondary" onClick={() => requestNavigation(onNext)} disabled={nextDisabled}>Next</button>}
          {openFullRecord && <button type="button" className="thera-action secondary" onClick={() => requestNavigation(openFullRecord)}>{openFullRecordLabel}</button>}
        </div></div>
      </header>
      <div className="thera-work-drawer-body">{children}</div>
      {footer && <div className="thera-work-drawer-footer">{dirty && <p role="status">Unsaved changes · save or cancel before switching records.</p>}{footer}</div>}
    </aside>;
  }
  return (
    <Sheet open={open} onOpenChange={requestOpenChange}>
      <SheetContent side="right" className="thera-work-drawer">
        <div className="thera-work-drawer-header">
          <SheetHeader>
            <div className="thera-work-drawer-heading-row">
              <div>
                <SheetTitle>{title}</SheetTitle>
                {subtitle ? <SheetDescription>{subtitle}</SheetDescription> : null}
              </div>
              {badges ? <div className="thera-work-drawer-badges">{badges}</div> : null}
            </div>
          </SheetHeader>

          {(queuePosition || onPrevious || onNext || openFullRecord) ? (
            <div className="thera-work-drawer-toolbar" aria-label="Record navigation">
              <div className="thera-work-drawer-queue">{queuePosition}</div>
              <div className="thera-work-drawer-toolbar-actions">
                {onPrevious ? <button type="button" className="thera-action secondary" onClick={() => requestNavigation(onPrevious)} disabled={previousDisabled}>Previous</button> : null}
                {onNext ? <button type="button" className="thera-action secondary" onClick={() => requestNavigation(onNext)} disabled={nextDisabled}>Next</button> : null}
                {openFullRecord ? <button type="button" className="thera-action secondary" onClick={() => requestNavigation(openFullRecord)}>{openFullRecordLabel}</button> : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="thera-work-drawer-body">{children}</div>

        {footer ? <div className="thera-work-drawer-footer">{footer}</div> : null}
      </SheetContent>
    </Sheet>
  );
}
