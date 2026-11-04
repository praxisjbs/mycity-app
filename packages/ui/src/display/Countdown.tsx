/**
 * @component Countdown
 * @group Display
 * @summary The time left until an end the server set, counted on the server's clock: a timed assessment's clock.
 * @use A deadline the server holds and enforces, given as its end and the server's own now: a timed assessment on the public site.
 * @avoid A date to show (use formatDate); a day something is due (say the day); progress through steps (use ProgressBar).
 * @phone The same clock at the same size; it sits at the top of the page, right of the question count, and never wraps.
 * @a11y A timer named by its label and the time left; it is silent each second and says once, politely, when the warning time, the last minute and the end arrive.
 * @status beta
 * @example <Countdown endsAt={session.ends_at} serverNow={session.server_now} onEnd={reload} />
 */
import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";

export interface CountdownProps {
  /** When the time runs out, ISO, as the server sent it. */
  endsAt: string;
  /** The server's time when it answered, ISO; the clock counts from it, so a wrong device clock changes nothing. */
  serverNow: string;
  /** Called once when the time runs out. */
  onEnd?: () => void;
  /** Seconds left at which the clock turns amber and says so; 300 unless set. The last minute is always red. */
  warnAt?: number;
  /** What the clock counts, Title Case; "Time Left" unless set. */
  label?: string;
  /** Layout classes only. */
  className?: string;
}

/** "45:00", "1:05:09": minutes and seconds, hours only when there are some. */
function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** "12 minutes", "1 minute", "40 seconds": the time left in words. */
function spoken(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s >= 120) return `${Math.ceil(s / 60)} minutes`;
  if (s >= 60) return "1 minute";
  return s === 1 ? "1 second" : `${s} seconds`;
}

export function Countdown({ endsAt, serverNow, onEnd, warnAt = 300, label = "Time Left", className }: CountdownProps) {
  /* How far the device's clock is from the server's, measured when the server answered. */
  const offset = useRef(0);
  const end = Date.parse(endsAt);
  const [now, setNow] = useState(() => {
    offset.current = Date.parse(serverNow) - Date.now();
    return Date.now() + offset.current;
  });
  const [said, setSaid] = useState("");
  const ended = useRef<string | null>(null);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  useEffect(() => {
    offset.current = Date.parse(serverNow) - Date.now();
    setNow(Date.now() + offset.current);
  }, [serverNow]);

  useEffect(() => {
    const tick = () => setNow(Date.now() + offset.current);
    const t = window.setInterval(tick, 1000);
    /* A tab in the background ticks slowly; coming back reads the clock at once. */
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  const left = Math.max(0, (end - now) / 1000);
  const stage = left <= 0 ? "end" : left <= 60 ? "last" : left <= warnAt ? "warn" : "ok";

  /* Say each threshold once, as it is crossed; nothing is said for the time on arrival. */
  const lastStage = useRef(stage);
  useEffect(() => {
    if (stage === lastStage.current) return;
    lastStage.current = stage;
    if (stage === "warn") setSaid(`${spoken(left)} left`);
    else if (stage === "last") setSaid("1 minute left");
    else if (stage === "end") setSaid("Time is up");
  }, [stage, left]);

  useEffect(() => {
    if (stage !== "end" || ended.current === endsAt) return;
    ended.current = endsAt;
    onEndRef.current?.();
  }, [stage, endsAt]);

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
