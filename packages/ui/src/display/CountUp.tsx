/**
 * @component CountUp
 * @group Display
 * @summary A whole number that counts up from 0 to its value as it first shows, easing out over about a second.
 * @use The public site's hero figures (Open Roles, Teams Hiring, Cities), where SkylineHero size index draws it for each of its `stats`; a figure a page opens on.
 * @avoid A number that changes while the person reads it (a count of new items, a timer: use Countdown or CountBadge); money (use Money); a list's total (the pager shows it).
 * @phone The same count, in the size the caller sets around it.
 * @a11y The value is read at once as the final number: the counting digits are hidden from assistive technology and a visually hidden copy carries the value. Under reduced motion the value shows straight away.
 * @status beta
 * @example <CountUp value={12} />
 * @example <CountUp value={7} delay={620} />
 */
import { useEffect, useState } from "react";
import { cn } from "../lib/cn";
import { useMediaQuery } from "../lib/media";

export interface CountUpProps {
  /** The number it ends on, a whole number of 0 or more. */
  value: number;
  /** How long it waits before it starts, in ms; 0 unless set (the hero's figures wait 500, then 120 more each). */
  delay?: number;
  /** How long the count takes, in ms; 1100 unless set. */
  duration?: number;
  /** Layout classes only; the figure takes the size and colour of what holds it. */
  className?: string;
}

/** How far along the count is at a fraction of its time: an ease-out cubic, quick at first and settling. */
export const easeOutCubic = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

export function CountUp({ value, delay = 0, duration = 1100, className }: CountUpProps) {
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const to = Math.max(0, Math.round(value));
  const [shown, setShown] = useState(() => (reduced ? to : 0));

  useEffect(() => {
    if (reduced || typeof window.requestAnimationFrame !== "function") {
      setShown(to);
      return;
    }
    let frame = 0;
    let start: number | null = null;
    setShown(0);
    const step = (t: number) => {
      if (start === null) start = t + delay;
      const x = (t - start) / duration;
      setShown(Math.round(to * easeOutCubic(x)));
      if (x < 1) frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [to, delay, duration, reduced]);

  return (
    <span className={cn("tabular-nums", className)}>
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{to}</span>
    </span>
  );
}
