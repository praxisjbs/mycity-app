/**
 * @component ResultLine
 * @group Assistant
 * @summary What came of pressing an action card: Done or Could Not Finish, then one line per record with a tick or a cross, the record's own words and Open where it has a screen.
 * @use Under an ActionCard once its press has finished (docs/guides/praxis-ai.md §6.11 step 6): the screen passes the result the API answered with (AiActionResult) and what Open does.
 * @avoid A card still open (ActionCard draws its buttons); a toast for the outcome (the line stays with the card); a list of records a person browses (DataView).
 * @phone The same lines, each Open a 44 px target; long record names wrap.
 * @a11y A status line named by its outcome, announced politely; the lines are a list, each naming its record and whether it went through; the icons are decorative and the words carry the meaning.
 * @status beta
 * @example <ResultLine result={{ status: "done", lines: [{ type: "task", id: "t1", label: "T-12 Send the report", ok: true, message: "created", link: "/workspace?tab=tasks&id=t1" }], message: null, error_code: null }} onOpen={navigate} />
 */
import { cn } from "../lib/cn";
import { content } from "../lib/slots";
import { Button } from "../actions/Button";
import { Icon } from "../icons/Icon";

/** One record's outcome, as the API answers it (AiActionLine). */
export interface CardLine {
  type: string;
  id: string | null;
  /** The record's own words (a task's number and title, a person's name). */
  label: string;
  ok: boolean;
  /** What happened to it, in the service's words ("created", "This task was cancelled"). */
  message: string | null;
  /** Where it opens, or null for a record with no screen. */
  link: string | null;
}

/** The press's outcome (AiActionResult, the parts the line shows). */
export interface CardResult {
  status: "done" | "failed";
  lines: CardLine[];
  /** Why it failed, in the service's words; null when it went through. */
  message: string | null;
  error_code: string | null;
}

export interface ResultLineProps {
  /** What the press came back with. */
  result: CardResult;
  /** Opens a record's screen. */
  onOpen?: (path: string) => void;
  /** Layout classes only (spacing). */
  className?: string;
}

export function ResultLine({ result, onOpen, className }: ResultLineProps) {
  const done = result.status === "done";
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <p role="status" className={cn("flex items-center gap-1.5 text-sm font-strong", done ? "text-success" : "text-destructive")}>
        <Icon name={done ? "tick" : "alert"} size="s" />
        {done ? "Done" : "Could Not Finish"}
        {!done && result.message && (
          <span {...content} className="font-normal text-foreground">
            {result.message}
          </span>
        )}
      </p>
      {result.lines.length > 0 && (
        <ul aria-label="Outcome" className="m-0 flex list-none flex-col gap-1 p-0">
          {result.lines.map((l, i) => (
            <li key={`${l.type}:${l.id ?? i}`} aria-label={`${l.label}, ${l.ok ? "done" : "not done"}`} className="flex flex-wrap items-center gap-1.5 text-sm">
              <Icon name={l.ok ? "tick" : "x"} size="s" className={l.ok ? "text-success" : "text-destructive"} />
              <span {...content} className="wrap-any">
                {l.label}
              </span>
              {l.message && (
                <span {...content} className="text-xs text-subtle-foreground">
                  {l.message}
                </span>
              )}
              {l.link && onOpen && (
                <Button size="sm" variant="ghost" iconRight="right" className="ml-auto" onClick={() => onOpen(l.link!)}>
                  Open
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
