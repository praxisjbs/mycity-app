/**
 * @component ExportButton
 * @group Data
 * @summary Asks the server for the whole filtered list as a file; the work goes to the worker and the file arrives in the Mailbox.
 * @use Beside a list that a person needs outside the product (a payroll run, an attendance month, an expense claim set).
 * @avoid Building a file in the browser from the 25 rows on screen; a download that blocks the page while a large list is gathered.
 * @phone The same button, full width in the toolbar; the toast confirms where the file will arrive.
 * @a11y Busy while the request is in flight, and the button stays pressable rather than disabled (FRONTEND_GUIDE §9.4).
 * @status stable
 * @example <ExportButton onExport={() => api.call("POST /api/v1/exports", { body: { source: "employees", filters } })} />
 */
import { useState } from "react";
import { Button } from "../actions/Button";
import { toast } from "../feedback/toast";

export interface ExportButtonProps {
  /**
   * Queues the export on the server for the list's CURRENT filters, which the
   * caller holds. It must ask the server for the whole filtered list, never
   * the page on screen.
   */
  onExport: () => Promise<unknown>;
  /** The label: Verb Noun, at most 3 words. "Export" unless set. */
  children?: string;
  /** What the toast says once it is queued. At most 8 words. */
  message?: string;
  /** Layout classes only (spacing). */
  className?: string;
}

/**
 * One Export per list (F20). The server gathers the whole filtered set in the
 * worker, because a list of 40,000 rows cannot be built inside a request, and
 * the finished file arrives in the person's Mailbox.
 */
export function ExportButton({ onExport, children = "Export", message = "Export queued", className }: ExportButtonProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      icon="download"
      busy={busy}
      className={className}
      onClick={async () => {
        setBusy(true);
        try {
          await onExport();
          toast(message);
        } catch {
          toast.error("Export could not start");
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </Button>
  );
}
