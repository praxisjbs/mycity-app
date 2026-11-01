/**
 * @component AnswerBubble
 * @group Assistant
 * @summary One answer of Praxis AI: its words, its table, Showing 25 of 312 with Show Next 25, the screen button, From with its source chips, Open Figures and Helpful or Not Helpful.
 * @use Each answer in the conversation, on the full screen and in the phone's chat; the screen passes the table it drew, the chips and what each press does. `card` is the slot the action card fills (PR4 of the Praxis AI Engine).
 * @avoid A message a person wrote (QuestionBubble, exported here); a notice or a banner; any other chat (Staff Community has its own).
 * @phone Full width; the table above it is cards (DataView); Open Figures opens the pane as a sheet; the buttons are 44 px targets.
 * @a11y An article named Answer; the words are content; Helpful and Not Helpful say their pressed state (aria-pressed) and wait for each other (ActionGroup); the chips are buttons when they open the pane.
 * @status beta
 * @exports QuestionBubble
 * @example <AnswerBubble text={a.content} table={table} paging="Showing 25 of 312" onNext={next} link={{ label: "Open Leave", onOpen }} from={chips} feedback={null} onFeedback={give} onPane={showPane} />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { ActionGroup } from "../actions/ActionGroup";
import { Button, IconButton } from "../actions/Button";
import { HelpTerm } from "../help/HelpTerm";

/** What Helpful or Not Helpful stands at. */
export type AnswerFeedback = "up" | "down";

export interface AnswerBubbleProps {
  /** The answer's words, as the model wrote them (content, not interface copy). */
  text: string;
  /** The table drawn from the read's rows (a bare DataView), under the words. */
  table?: ReactNode;
  /** Where the table's rows sit in the whole list ("Showing 25 of 312", "Showing 26 to 50 of 312"). */
  paging?: string | null;
  /** Show Next 25: asks for the next page as a follow-up; the button is busy until it lands. */
  onNext?: () => Promise<unknown> | void;
  /** The screen button: where the person would act, or the form a change opens filled. */
  link?: { label: string; onOpen: () => void } | null;
  /** The source chips after From (SourceChip), one per kind of record read. */
  from?: ReactNode;
  /** Opens this answer's pane (Open Figures): the right pane on desktop, the sheet on a phone. */
  onPane?: () => void;
  /** This answer's pane is the one shown: drawn in the accent, with no Open Figures. */
  paneOpen?: boolean;
  /** Where Helpful or Not Helpful stands. */
  feedback?: AnswerFeedback | null;
  /** The press on Helpful or Not Helpful; null takes it back. */
  onFeedback?: (value: AnswerFeedback | null) => Promise<unknown> | void;
  /** The action card drawn under the words, when the answer carries one (filled by PR4 of the Praxis AI Engine). */
  card?: ReactNode;
  /** Layout classes only (spacing). */
  className?: string;
}

const FROM_HELP = "The kinds of record this answer was read from, as you would see them. A chip opens them in the pane; a table's rows open their own records.";

export function AnswerBubble({ text, table, paging, onNext, link, from, onPane, paneOpen, feedback = null, onFeedback, card, className }: AnswerBubbleProps) {
  return (
    <article
      aria-label="Answer"
      aria-current={paneOpen ? "true" : undefined}
      className={cn("flex max-w-11/12 flex-col gap-2.5 bubble-them border bg-card p-3 max-md:max-w-full", paneOpen ? "border-secondary dark:border-accent-foreground" : "border-border", className)}
    >
      <p data-copy="content" className="text-sm whitespace-pre-line wrap-any">
        {text}
      </p>
      {card}
      {table}
      {(paging || onNext) && (
        <div className="flex flex-wrap items-center gap-2">
          {paging && <span className="text-xs text-subtle-foreground">{paging}</span>}
          {onNext && (
            <Button size="sm" onClick={onNext}>
              Show Next 25
            </Button>
          )}
        </div>
      )}
      {(link || (onPane && !paneOpen)) && (
        <div className="flex flex-wrap items-center gap-2">
          {link && (
            <Button iconRight="right" onClick={link.onOpen}>
              {link.label}
            </Button>
          )}
          {onPane && !paneOpen && (
            <Button variant="ghost" icon="chart" onClick={onPane}>
              Open Figures
            </Button>
          )}
        </div>
      )}
      {from != null && from !== false && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-dashed border-border pt-2.5">
          <span className="text-2xs font-strong tracking-caps text-subtle-foreground uppercase">
            <HelpTerm help={FROM_HELP}>From</HelpTerm>
          </span>
          {from}
        </div>
      )}
      {onFeedback && (
        <div className="flex items-center gap-1">
          <ActionGroup>
            <IconButton size="sm" icon="thumb" label="Helpful" aria-pressed={feedback === "up"} className={cn(feedback === "up" && "bg-muted text-foreground")} onClick={() => onFeedback(feedback === "up" ? null : "up")} />
            <IconButton size="sm" icon="thumbdown" label="Not Helpful" aria-pressed={feedback === "down"} className={cn(feedback === "down" && "bg-muted text-foreground")} onClick={() => onFeedback(feedback === "down" ? null : "down")} />
          </ActionGroup>
        </div>
      )}
    </article>
  );
}

export interface QuestionBubbleProps {
  /** The person's words. */
  words: string;
  /** Layout classes only (spacing). */
  className?: string;
}

/** The person's question, as their own bubble at the right. */
export function QuestionBubble({ words, className }: QuestionBubbleProps) {
  return (
    <p data-copy="content" className={cn("ml-auto w-fit max-w-4/5 bubble-me border border-border bg-accent px-3 py-2.5 text-sm wrap-any", className)}>
      {words}
    </p>
  );
}
