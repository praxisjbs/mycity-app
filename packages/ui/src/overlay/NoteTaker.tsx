/**
 * @component NoteTaker
 * @group Overlays
 * @summary A small notes panel that floats over a page while the person keeps working: moved by its bar, minimised to that bar, or closed. Nothing behind it is blocked.
 * @use A person's own notes beside what they read or watch (ESS · My Training's My Notes on a course), saved by the screen as they type.
 * @avoid A form saved with a button (Modal); a comment others read (a thread); anything that must stop the person until it is answered (ConfirmDialog).
 * @phone Docked full width at the foot of the screen or the sheet, with a 44 px Move to Top (Move to Bottom) in its bar instead of dragging (F19); minimised, it is its bar alone.
 * @a11y A labelled region, not a dialog: focus moves into the note when it opens and is never trapped. On desktop Move Notes drags it, or the arrow keys move it while that button has focus. Saving, Saved and Not saved are announced politely.
 * @status beta
 * @example <NoteTaker open={open} onClose={() => setOpen(false)} subject={course.title} value={body} onChange={setBody} saved="saved" />
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "../lib/cn";
import { content } from "../lib/slots";
import { useIsPhone } from "../lib/media";
import { IconButton } from "../actions/Button";
import { TextAreaField } from "../form/TextField";

/** Where the note's last save stands: under way, done, refused, or nothing typed yet. */
export type NoteSave = "saving" | "saved" | "failed" | null;

export interface NoteTakerProps {
  /** Shown or not; the screen keeps it, so a Take Notes button opens it again. */
  open: boolean;
  /** Close Notes: the panel goes; what was typed is the screen's to keep. Return the last save and the button waits for it. */
  onClose: () => void | Promise<unknown>;
  /** What the notes are on (a course's title), under the panel's name. */
  subject?: string;
  /** The note's text. */
  value: string;
  /** Every keystroke; the screen saves it (after a pause, as a draft is). */
  onChange: (value: string) => void;
  /** Where the last save stands: Saving, Saved or Not saved in the bar. */
  saved?: NoteSave;
  /** Try Again beside Not saved. */
  onRetry?: () => void | Promise<unknown>;
  /** The longest note the server keeps, in characters. */
  maxLength?: number;
  /** The note is still loading: the box waits, read only. */
  loading?: boolean;
  /** The panel's name; My Notes. */
  label?: string;
}

/** Room kept between the panel and the window's edges, and one arrow key's move, in px. */
const GAP = 16;
const STEP = 24;
const SAVED: Record<Exclude<NoteSave, null>, string> = { saving: "Saving", saved: "Saved", failed: "Not saved" };

type At = { x: number; y: number };

export function NoteTaker({ open, onClose, subject, value, onChange, saved = null, onRetry, maxLength, loading, label = "My Notes" }: NoteTakerProps) {
  const phone = useIsPhone();
  const [small, setSmall] = useState(false);
  const [atTop, setAtTop] = useState(false);
  const [at, setAt] = useState<At | null>(null);
  const box = useRef<HTMLElement>(null);
  const grab = useRef<At | null>(null);

  // Opening shows the whole panel with the cursor in the note.
  useEffect(() => {
    if (!open) return;
    setSmall(false);
    const t = window.setTimeout(() => box.current?.querySelector("textarea")?.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  /** Inside the window, the panel whole, whatever its size now. */
  const within = (p: At): At => {
    const w = box.current?.offsetWidth ?? 0;
    const h = box.current?.offsetHeight ?? 0;
    return {
      x: Math.round(Math.min(Math.max(GAP, p.x), Math.max(GAP, window.innerWidth - w - GAP))),
      y: Math.round(Math.min(Math.max(GAP, p.y), Math.max(GAP, window.innerHeight - h - GAP))),
    };
  };

  // A smaller window, or the panel grown back from its bar, keeps it on screen.
  useEffect(() => {
    if (phone || !open) return;
    const fit = () => setAt((p) => (p ? within(p) : p));
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [phone, open]);
  useLayoutEffect(() => {
    if (!phone && open) setAt((p) => (p ? within(p) : p));
  }, [small, phone, open]);

  if (!open) return null;

  const here = (): At => {
    const r = box.current?.getBoundingClientRect();
    return r ? { x: r.left, y: r.top } : { x: GAP, y: GAP };
  };
  const startDrag = (e: PointerEvent<HTMLElement>) => {
    if (phone || e.button !== 0) return;
    const p = here();
    grab.current = { x: e.clientX - p.x, y: e.clientY - p.y };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const drag = (e: PointerEvent<HTMLElement>) => {
    if (grab.current) setAt(within({ x: e.clientX - grab.current.x, y: e.clientY - grab.current.y }));
  };
  const drop = () => {
    grab.current = null;
  };
  const nudge = (e: KeyboardEvent<HTMLElement>) => {
    const by: Record<string, At> = { ArrowLeft: { x: -STEP, y: 0 }, ArrowRight: { x: STEP, y: 0 }, ArrowUp: { x: 0, y: -STEP }, ArrowDown: { x: 0, y: STEP } };
    const d = by[e.key];
    if (!d) return;
    e.preventDefault();
    const p = here();
    setAt(within({ x: p.x + d.x, y: p.y + d.y }));
  };

  const place = phone
    ? cn("inset-x-3", atTop ? "top-3" : "bottom-3")
    : at
      ? "left-(--note-x) top-(--note-y)"
      : "right-4 bottom-4";
  const where = !phone && at ? ({ "--note-x": `${at.x}px`, "--note-y": `${at.y}px` } as CSSProperties) : undefined;

  return (
    <section
      ref={box}
      aria-label={label}
      data-pull="off"
      className={cn("fixed z-40 flex flex-col overflow-hidden rounded-card border border-border bg-card shadow-3", phone ? "" : "w-80", place)}
      style={where}
    >
      <div
        className={cn("flex items-center gap-1 border-b border-border bg-muted py-1 pr-1 pl-3", small && "border-b-0", !phone && "cursor-grab touch-none select-none active:cursor-grabbing")}
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={drop}
        onPointerCancel={drop}
      >
        <div className="min-w-0 flex-1 py-1">
          <h2 data-ui="title" className="text-sm font-semibold text-foreground">
            {label}
          </h2>
          {subject && (
            <p {...content} className="truncate text-xs text-muted-foreground">
              {subject}
            </p>
          )}
        </div>
        <span role="status" aria-live="polite" className={cn("flex-none text-xs", saved === "failed" ? "text-destructive" : "text-muted-foreground")}>
          {saved ? SAVED[saved] : ""}
        </span>
        {saved === "failed" && onRetry && <IconButton icon="refresh" label="Try Again" size="sm" onClick={onRetry} />}
        {phone ? (
          <IconButton icon={atTop ? "down" : "up"} label={atTop ? "Move to Bottom" : "Move to Top"} size="sm" onClick={() => setAtTop((t) => !t)} />
        ) : (
          <IconButton icon="drag" label="Move Notes" size="sm" className="cursor-grab" onKeyDown={nudge} />
        )}
        <IconButton icon={small ? "expand" : "minus"} label={small ? "Open Notes" : "Minimise Notes"} size="sm" onClick={() => setSmall((s) => !s)} />
        <IconButton icon="x" label="Close Notes" size="sm" onClick={onClose} />
      </div>
      {!small && (
        <div className="p-2">
          <TextAreaField
            aria-label={subject ? `${label} on ${subject}` : label}
            value={value}
            onChange={onChange}
            maxLength={maxLength}
            readOnly={loading}
            aria-busy={loading || undefined}
            rows={phone ? 6 : 12}
            className="min-h-0 resize-none border-0 shadow-none"
          />
        </div>
      )}
    </section>
  );
}
