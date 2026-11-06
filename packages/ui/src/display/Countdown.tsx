/**
 * @component Countdown
 * @group Display
 * @summary The time left until an end the server set, counted on the server's clock: a timed assessment's clock.
 * @use A deadline the server holds and enforces, given as its end and the server's own now from the same answer: a timed assessment on the public site.
 * @avoid A date to show (use formatDate); a day something is due, such as an untimed take-home brief (say the day; with endsAt null nothing is drawn); progress through steps (use ProgressBar).
 * @phone The same clock at the same size; it sits at the top of the page, right of the question count, and never wraps.
 * @a11y A timer named by its label and the time left; silent each second, it says once, politely, the time really left when the warning time and the last minute arrive, and Time is up at the end. Nothing is said when it first shows.
 * @status beta
 * @example <Countdown endsAt={session.ends_at} serverNow={session.server_now} onEnd={reload} />
 * @example <Countdown look="ring" total={3600} endsAt={session.ends_at} serverNow={session.server_now} onEnd={reload} />
 */
import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";

export interface CountdownProps {
  /** When the time runs out, ISO, as the server sent it; null (an untimed sitting) draws nothing. */
  endsAt: string | null;
  /** The server's time in the same answer, ISO. The clock counts from when this answer first arrived, so a wrong device clock or a remount changes nothing. */
  serverNow: string;
  /** Called when the time runs out, and again every `retryEvery` seconds while it stays run out (the server may take a moment to close it). */
  onEnd?: () => unknown;
  /** Seconds left at which the clock turns amber and says so; 300 unless set. The last minute is always red. */
  warnAt?: number;
  /** Seconds between calls to onEnd once the time has run out; 10 unless set. */
  retryEvery?: number;
  /** What the clock counts, Title Case; "Time Left" unless set. */
  label?: string;
  /** `ring`: the public site's, the time left in a ring that empties as it runs, red for the last five minutes; pass `total`. */
  look?: "default" | "ring";
  /** ring: the whole time, in seconds, that the ring stands for (the assessment's minutes × 60). */
  total?: number;
  /** Layout classes only. */
  className?: string;
}

type Stage = "ok" | "warn" | "last" | "end";

/*
 * When each server answer was first seen on this device. The offset between the server's clock
 * and the device's is fixed when the answer arrives, not when a clock mounts: a clock that remounts
 * (the shell changing at 760 px, a revisit served from what is already loaded) keeps counting from
 * the same moment instead of starting the time left again.
 */
const firstSeen = new Map<string, number>();
function offsetOf(serverNow: string): number {
  let at = firstSeen.get(serverNow);
  if (at === undefined) {
    at = Date.now();
    firstSeen.set(serverNow, at);
    if (firstSeen.size > 32) firstSeen.delete(firstSeen.keys().next().value as string);
  }
  const server = Date.parse(serverNow);
  return Number.isFinite(server) ? server - at : 0;
}

/** "45:00", "1:05:09": minutes and seconds, hours only when there are some. */
function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** The time left in words, never more than is left: "12 minutes", "1 minute 30 seconds", "40 seconds". */
function spoken(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s >= 120) return `${Math.floor(s / 60)} minutes`;
  if (s >= 60) {
    const rest = s - 60;
    return rest ? `1 minute ${rest} ${rest === 1 ? "second" : "seconds"}` : "1 minute";
  }
  return s === 1 ? "1 second" : `${s} seconds`;
}

const stageOf = (left: number, warnAt: number): Stage =>
  left <= 0 ? "end" : left <= 60 ? "last" : left <= warnAt ? "warn" : "ok";

/** The ring's circumference at radius 88 on its 200 unit box. */
const RING = 2 * Math.PI * 88;

export function Countdown({ endsAt, serverNow, onEnd, warnAt = 300, retryEvery = 10, label = "Time Left", look = "default", total, className }: CountdownProps) {
  const end = endsAt ? Date.parse(endsAt) : Number.NaN;
  const timed = Number.isFinite(end);
  const offset = offsetOf(serverNow);
  const [now, setNow] = useState(() => Date.now());
  const [said, setSaid] = useState("");
  const onEndRef = useRef(onEnd);
  /** The stage last drawn for this end, and when onEnd was last called for it. */
  const seen = useRef<{ end: number; stage: Stage; calledAt: number | null } | null>(null);

  useEffect(() => {
    onEndRef.current = onEnd;
  });

  const left = timed ? Math.max(0, (end - (now + offset)) / 1000) : 0;
  const stage = stageOf(left, warnAt);

  /* The next redraw lands just after the shown second changes, so 00:00 shows the moment the time is up. */
  useEffect(() => {
    if (!timed) return undefined;
    const ms = end - (Date.now() + offset);
    const wait = ms <= 0 ? Math.max(1, retryEvery) * 1000 : ms % 1000 || 1000;
    const t = window.setTimeout(() => setNow(Date.now()), wait);
    return () => window.clearTimeout(t);
  }, [now, end, offset, timed, retryEvery]);

  /* A tab in the background ticks slowly; coming back reads the clock at once. */
  useEffect(() => {
    const read = () => setNow(Date.now());
    document.addEventListener("visibilitychange", read);
    return () => document.removeEventListener("visibilitychange", read);
  }, []);

  /* Say a threshold as it is crossed, with the time really left; call onEnd at the end, and again while it stays ended. */
  useEffect(() => {
    if (!timed) return;
    const prev = seen.current && seen.current.end === end ? seen.current : null;
    const at = Date.now();
    let calledAt = prev ? prev.calledAt : null;
    if (prev && prev.stage !== stage) {
      if (stage === "end") setSaid("Time is up");
      else if (stage === "warn" || stage === "last") setSaid(`${spoken(left)} left`);
    }
    if (stage === "end" && (calledAt === null || at - calledAt >= Math.max(1, retryEvery) * 1000 - 50)) {
      calledAt = at;
      onEndRef.current?.();
    }
    if (stage !== "end") calledAt = null;
    seen.current = { end, stage, calledAt };
  }, [timed, end, stage, left, now, retryEvery]);

  if (!timed) return null;
  if (look === "ring") {
    const whole = total && total > 0 ? total : Math.max(left, 1);
    const offsetDash = (RING * (1 - Math.min(1, left / whole))).toFixed(1);
    return (
      <div className={cn("ps-ring", className)} data-stage={stage} data-low={stage !== "ok" || undefined}>
        <svg viewBox="0 0 200 200" aria-hidden="true" focusable="false">
          <circle className="ps-ring-track" cx="100" cy="100" r="88" fill="none" strokeWidth="12" />
          <circle className="ps-ring-arc" cx="100" cy="100" r="88" fill="none" strokeWidth="12" strokeLinecap="round" strokeDasharray={RING.toFixed(1)} strokeDashoffset={offsetDash} />
        </svg>
        <div className="ps-ring-in" role="timer" aria-live="off" aria-label={`${label}: ${spoken(left)}`}>
          <b aria-hidden="true">{formatClock(left)}</b>
          <span aria-hidden="true">left</span>
        </div>
        <span role="status" aria-live="polite" className="sr-only">
          {said}
        </span>
      </div>
    );
  }
  return (
    <div className={cn("inline-flex flex-col items-end", className)} data-stage={stage}>
      <div
        role="timer"
        aria-live="off"
        aria-label={`${label}: ${spoken(left)}`}
        className={cn(
          "inline-flex items-center gap-1.5 text-2xl font-strong tracking-tight whitespace-nowrap tabular-nums",
          stage === "ok" && "text-foreground",
          stage === "warn" && "text-warning",
          (stage === "last" || stage === "end") && "text-destructive",
        )}
      >
        <Icon name="clock" size="m" />
        <span>{formatClock(left)}</span>
      </div>
      <span aria-hidden="true" className="text-2xs text-muted-foreground">
        {label}
      </span>
      <span role="status" aria-live="polite" className="sr-only">
        {said}
      </span>
    </div>
  );
}
