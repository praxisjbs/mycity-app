/**
 * @component ExportButton
 * @group Data
 * @summary Asks the server for the whole filtered list as a file and saves it on the device that pressed, once the worker has made it.
 * @use Beside a list that a person needs outside the product (a payroll run, an attendance month, an expense claim set).
 * @avoid Building a file in the browser from the 25 rows on screen; sending the file anywhere but the device that pressed.
 * @phone The same button, full width in the toolbar; the file goes to Downloads, or the share sheet on an iPhone app.
 * @a11y Busy until the file is saved, and the button stays pressable rather than disabled (FRONTEND_GUIDE §9.4).
 * @status stable
 * @example <ExportButton onExport={() => saveExport(api.call("POST /api/v1/audit/exports", { body: filters }))} />
 */
import { useState } from "react";
import { Button } from "../actions/Button";
import { toast } from "../feedback/toast";
import { ApiError } from "./createApi";

export interface ExportButtonProps {
  /**
   * Makes the file of the list's CURRENT filters, which the caller holds, and saves it on this
   * device: it asks the server for the whole filtered list, never the page on screen, waits for
   * the file and saves it. Resolves once it is saved; resolving `false` means nothing was saved
   * and the person has already been told why, so no toast says otherwise.
   */
  onExport: () => Promise<unknown>;
  /** The label: Verb Noun, at most 3 words. "Export" unless set. */
  children?: string;
  /** What the toast says once the file is saved. At most 8 words. */
  message?: string;
  /** Layout classes only (spacing). */
  className?: string;
}

/**
 * One Export per list (F20). The server gathers the whole filtered set in the worker, because a
 * list of 40,000 rows cannot be built inside a request; the button is busy while it does, and
 * the file lands on the device that pressed. A failure is one line: the server's own words when
 * it gave a reason, else a plain one.
 */
export function ExportButton({ onExport, children = "Export", message = "Export downloaded", className }: ExportButtonProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      icon="download"
      busy={busy}
      className={className}
      onClick={async () => {
        setBusy(true);
        try {
          if ((await onExport()) !== false) toast(message);
        } catch (e) {
          toast.error(e instanceof ApiError ? e.message : "Export failed. Try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </Button>
  );
}
