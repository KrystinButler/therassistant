import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";
import "./work-drawer.css";

export type WorkDrawerProps = {
  open: boolean;
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
  function requestOpenChange(nextOpen: boolean) {
    if (!nextOpen && dirty && !confirmDiscard()) return;
    onOpenChange(nextOpen);
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
                {onPrevious ? <button type="button" className="thera-action secondary" onClick={onPrevious} disabled={previousDisabled}>Previous</button> : null}
                {onNext ? <button type="button" className="thera-action secondary" onClick={onNext} disabled={nextDisabled}>Next</button> : null}
                {openFullRecord ? <button type="button" className="thera-action secondary" onClick={openFullRecord}>{openFullRecordLabel}</button> : null}
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
