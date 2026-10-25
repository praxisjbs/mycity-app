/**
 * @component ListDetail
 * @group Layout
 * @summary A list and the record a row opens: side by side on a wide desktop, and on a phone the list alone with the opened record in a bottom sheet, never below the list (F31).
 * @use Any list whose row opens a record on the same screen: leave requests, payslips, proposals, offers, letter templates. DetailPane is the same rule for a record the desktop layout places elsewhere on the page (under the list beside a chart, above the list). `useSideBySide()` says when a first pick may show unasked.
 * @avoid A record with its own screen (navigate to its `id`); a reader read one at a time that fills the screen (SplitPanes: the mailbox, chat); a form (Modal); a record shown below its list on a phone, in any shape.
 * @phone No second column: the list fills the page and a tapped row opens its record in the shared Modal, a bottom sheet that drags down to close (`full` for a payslip, a letter or a document). Nothing opens until a row is tapped, so the screen's first pick is a desktop convenience only (`useSideBySide`). Between 761 and 1180 px, where two columns do not fit, the record opens in the centred dialog.
 * @a11y The sheet is the shared Modal: titled by `title`, focus moves in and returns to the row on close, Esc and the phone's Back close it (F29). Side by side, the record is a plain column after the list in reading order.
 * @status stable
 * @exports DetailPane
 * @example const beside = useSideBySide(); const shown = picked ?? (beside ? rows[0] : null);
 * @example <ListDetail open={!!picked} onClose={() => setPicked(null)} title="Leave Request" list={<DataView ... onRowClick={setPicked} />} detail={shown && <RequestCard leave={shown} />} />
 * @example <DetailPane open={!!picked} onClose={() => setPicked(null)} title="Query">{focus && <QueryCard id={focus} />}</DetailPane>
 */
import { useRef, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useIsPhone, useMediaQuery } from "../lib/media";
import { Modal } from "../overlay/Modal";
import { Grid } from "./Grid";

/** Wide enough for the list and the record side by side: the `xl` width, where Grid's uneven pairs stop stacking. */
export const SIDE_BY_SIDE_QUERY = "(min-width: 1181px)";

/**
 * true while ListDetail draws the record beside the list. A screen picks a
 * first record to show only then: on a phone, and on a desktop too narrow for
 * two columns, nothing opens until a row is tapped.
 */
export const useSideBySide = (): boolean => useMediaQuery(SIDE_BY_SIDE_QUERY);

/*
 * The record's own card sits flat in the sheet: the sheet is already its
 * surface, so a border, a shadow and a second padding would frame it twice.
 */
const FLAT = "[&>[data-card]]:border-0 [&>[data-card]]:bg-transparent [&>[data-card]]:p-0 [&>[data-card]]:shadow-none";

/** Whether there is a record to show (a screen passes `x && <Card />`, so false and undefined are none). */
const shows = (node: ReactNode) => node !== null && node !== undefined && node !== false;

/**
 * The opened record in the shared Modal (a bottom sheet on a phone). It keeps
 * the last record while it slides away, so the sheet never empties as it closes.
 */
function RecordSheet({ open, onClose, title, full, wide, container, record }: { open: boolean; onClose: () => void; title: ReactNode; full?: boolean; wide?: boolean; container?: HTMLElement | null; record: ReactNode }) {
  const showing = open && shows(record);
  const last = useRef<ReactNode>(null);
  if (showing) last.current = record;
  return (
    <Modal open={showing} onClose={onClose} title={title} full={full} wide={wide} container={container} bodyClassName={FLAT}>
      {showing ? record : last.current}
    </Modal>
  );
}

export interface ListDetailProps {
  /** The list: a DataView or a paged table whose `onRowClick` picks the record. */
  list: ReactNode;
  /** The record in view: the picked one, or side by side the screen's first pick (null for none). */
  detail: ReactNode;
  /** A row was picked: on a phone, and on a desktop too narrow for two columns, its record opens in a sheet. */
  open: boolean;
  /** Closes the opened record (a drag down, Esc, Back or the close button); the screen drops its pick. */
  onClose: () => void;
  /** The sheet's title: a noun phrase of at most 4 words, Title Case ("Leave Request"). */
  title: ReactNode;
  /** Side by side, which column is wider: the list (`1.4/1`, the default) or the record (`1/1.5`: a payslip, a letter). */
  cols?: "1.4/1" | "1/1.5";
  /** The sheet fills the phone's screen, for a record read like a document (a payslip, a letter). */
  full?: boolean;
  /** Where the sheet mounts; document.body by default (the gallery passes its themed frame). */
  container?: HTMLElement | null;
  /** Layout classes only (spacing), on the side-by-side grid. */
  className?: string;
}

export function ListDetail({ list, detail, open, onClose, title, cols = "1.4/1", full, container, className }: ListDetailProps) {
  const beside = useSideBySide();
  if (beside) {
    return (
      <Grid cols={cols} className={className}>
        <div className="min-w-0">{list}</div>
        <div className="min-w-0">{detail}</div>
      </Grid>
    );
  }
  return (
    <>
      <div className={cn("min-w-0", className)}>{list}</div>
      <RecordSheet open={open} onClose={onClose} title={title} full={full} wide={cols === "1/1.5"} container={container} record={detail} />
    </>
  );
}

export interface DetailPaneProps {
  /** A record was picked: on a phone it opens in a sheet. */
  open: boolean;
  /** Closes the opened record on a phone (a drag down, Esc, Back or the close button); the screen drops its pick. */
  onClose: () => void;
  /** The sheet's title: a noun phrase of at most 4 words, Title Case ("Expense Request"). */
  title: ReactNode;
  /** The sheet fills the phone's screen, for a record read like a document. */
  full?: boolean;
  /** Where the sheet mounts; document.body by default (the gallery passes its themed frame). */
  container?: HTMLElement | null;
  /** The record, drawn where the pane sits on desktop. */
  children?: ReactNode;
}

/**
 * The record a list opened, where the screen's desktop layout puts it (under
 * the list beside a chart, or above it); on a phone, a bottom sheet while a
 * row is picked and nothing in the page at all.
 */
export function DetailPane({ open, onClose, title, full, container, children }: DetailPaneProps) {
  const phone = useIsPhone();
  if (!phone) return <>{children}</>;
  return <RecordSheet open={open} onClose={onClose} title={title} full={full} container={container} record={children} />;
}
