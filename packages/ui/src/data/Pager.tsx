/**
 * @component Pager
 * @group Data
 * @summary Page controls under a list, showing the server's true total ("312 employees") and Previous and Next.
 * @use Under any server-paged list: DataView draws one for you, and a card grid or a picker that pages itself takes one directly.
 * @avoid A page-size chooser, a jump-to-page box, or "showing 25 of many"; the size is the server's 25 and is never offered.
 * @phone The count sits above the buttons, which are full width and 44 px, so paging is a thumb reach.
 * @a11y A navigation landmark named for what is being paged; the count is a live region, so a screen reader hears the new range after Next.
 * @status stable
 * @example <Pager page={list.page} onPage={list.setPage} noun="employee" />
 */
import { cn } from "../lib/cn";
import { formatCount } from "../lib/format";
import { Button } from "../actions/Button";
import type { PageMeta } from "./createApi";

export interface PagerProps {
  /** The `page` object from the list response; nothing is drawn without it. */
  page: PageMeta | undefined | null;
  /** Asks for a page number. */
  onPage: (number: number) => void;
  /** What one row is, lower case ("employee"); "record" unless set. */
  noun?: string;
  /** The plural, when it is not the noun with an s ("people", "queries"). */
  nounPlural?: string;
  /** Layout classes only (spacing). */
  className?: string;
}

/**
 * The only place a list's total appears (FRONTEND_GUIDE §4). The range and the
 * total come from the server's `page`, so they cannot disagree with the rows.
 */
export function Pager({ page, onPage, noun = "record", nounPlural, className }: PagerProps) {
  if (!page) return null;
  const word = page.total === 1 ? noun : (nounPlural ?? `${noun}s`);
  const from = page.total === 0 ? 0 : (page.number - 1) * page.size + 1;
  const to = Math.min(page.number * page.size, page.total);
  const count =
    page.total === 0
      ? `0 ${word}`
      : page.total <= page.size
        ? `${formatCount(page.total)} ${word}`
        : `${formatCount(from)} to ${formatCount(to)} of ${formatCount(page.total)} ${word}`;

  return (
    <nav aria-label={`${word} pages`} className={cn("flex flex-wrap items-center gap-2.5 px-3.5 py-3 phone:flex-col phone:items-stretch", className)}>
      <span aria-live="polite" className="text-2xs text-subtle-foreground phone:text-center">
        {count}
      </span>
      {page.pages > 1 && (
        <span className="flex items-center gap-2 desk:ml-auto phone:w-full">
          <Button disabled={page.number <= 1} icon="left" onClick={() => onPage(page.number - 1)} className="phone:flex-1">
            Previous
          </Button>
          <span className="text-2xs whitespace-nowrap text-subtle-foreground">
            Page {page.number} of {page.pages}
          </span>
          <Button disabled={!page.has_next} iconRight="right" onClick={() => onPage(page.number + 1)} className="phone:flex-1">
            Next
          </Button>
        </span>
      )}
    </nav>
  );
}
