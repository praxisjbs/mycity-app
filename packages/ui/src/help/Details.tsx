/**
 * @component Details
 * @group Help
 * @summary One row at the foot of a card, a chevron and the word Details, that opens a short section of support facts.
 * @use Tier 2 facts a person needs now and then to act on the card above it: the rules a figure counts, a schedule's grace period, a policy line. Short label and value pairs rather than prose, at most 60 words.
 * @avoid One or two sentences about one word (use HelpTerm); how the system works or why it was built (tier 3: the manual); more than one per card; anything a person needs every visit (show it open).
 * @phone A 44 px row that opens the body in a bottom sheet, closed by dragging down.
 * @a11y A button with aria-expanded that controls the body (desktop) or says it opens a dialog (phone). Closed on every visit: the open state is never remembered. The body (data-ui="details") stays in the DOM, hidden, so the word limit can be checked.
 * @status stable
 * @example <Card details={<Details items={[["Grace Period", "10 minutes"], ["Counts From", "Shift start"]]} />}>...</Card>
 */
import { useId, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useIsPhone } from "../lib/media";
import { Icon } from "../icons/Icon";
import { Sheet } from "../overlay/Sheet";
import { WORD_LIMITS, countWords } from "./words";

export interface DetailsProps {
  /** Short label and value pairs, Title Case labels ("Grace Period", "10 minutes"). Preferred over prose. */
  items?: Array<[ReactNode, ReactNode]>;
  /** Free content, after the pairs, when pairs do not fit: one or two short lines. */
  children?: ReactNode;
  /** The phone sheet's title, at most 4 words. Default "Details". */
  title?: string;
  /** Where the phone sheet mounts; document.body by default (the gallery passes its themed frame). */
  container?: HTMLElement | null;
  /** Layout classes only. */
  className?: string;
}

/** Plain text of the pairs and the body, for the development word check. */
function plainText(items: DetailsProps["items"], children: ReactNode): string {
  const parts: unknown[] = [...(items ?? []).flat(), children];
  return parts.filter((p) => typeof p === "string" || typeof p === "number").join(" ");
}

function Body({ id, items, children, hidden, inline }: { id?: string; items?: DetailsProps["items"]; children?: ReactNode; hidden?: boolean; inline?: boolean }) {
  return (
    <div id={id} data-ui="details" hidden={hidden} className={cn("text-sm text-muted-foreground", inline && "pt-1 pb-2 pl-6")}>
      {items && items.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {items.map(([label, value], i) => (
            <div key={i} className="contents">
              <dt>{label}</dt>
              <dd className="m-0 text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {children != null && <div className={cn(items?.length ? "mt-2" : undefined)}>{children}</div>}
    </div>
  );
}

export function Details({ items, children, title = "Details", container, className }: DetailsProps) {
  const phone = useIsPhone();
  const bodyId = `details-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  // Closed on every visit (FRONTEND_GUIDE §5.2): never read from or written to storage.
  const [open, setOpen] = useState(false);
  if (import.meta.env.DEV) {
    const n = countWords(plainText(items, children));
    if (n > WORD_LIMITS.details) console.warn(`Details row is ${n} words (limit ${WORD_LIMITS.details}, FRONTEND_GUIDE §5.2).`);
  }

  return (
    <div data-details="" className={className}>
      <button
        type="button"
        data-ui="button"
        aria-expanded={open}
        aria-controls={phone ? undefined : bodyId}
        aria-haspopup={phone ? "dialog" : undefined}
        onClick={() => setOpen(!open)}
        className="flex min-h-control w-full items-center gap-1.5 rounded-ctl px-1 text-left text-sm font-semibold text-muted-foreground transition-colors duration-(--dur-fast) hover:text-foreground phone:min-h-tap"
      >
        <Icon name="right" className={cn("transition-transform duration-(--dur-fast)", open && !phone && "rotate-90")} />
        Details
      </button>
      {/* The body stays in the DOM, hidden while closed, so a screen check can count it. */}
      <Body id={bodyId} items={items} hidden={phone || !open} inline>
        {children}
      </Body>
      {phone && (
        <Sheet open={open} onClose={() => setOpen(false)} title={title} container={container}>
          <Body items={items}>{children}</Body>
        </Sheet>
      )}
    </div>
  );
}
