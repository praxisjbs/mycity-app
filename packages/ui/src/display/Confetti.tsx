/**
 * @component Confetti
 * @group Display
 * @summary Pieces of paper or stars drifting down behind a celebration card.
 * @use Behind a birthday or a work anniversary in the Staff Community, and nowhere a person is working.
 * @avoid A saved form, a completed task or anything a person does many times a day; a screen that needs reading while it moves.
 * @phone The same pieces at the same pace; they stop under reduced motion, like every other animation.
 * @a11y Decorative and hidden from screen readers, and it stops entirely under prefers-reduced-motion (base.css).
 * @status stable
 * @example <Confetti />
 * @example <Confetti shape="stars" />
 */
import type { CSSProperties } from "react";
import { cn } from "../lib/cn";

/** How many pieces fall. Enough to read as a celebration, few enough to stay cheap. */
const PIECES = 16;

/** The series each piece takes, so the colours are the chart tokens and change with the theme. */
const SERIES = [1, 2, 3, 4, 5] as const;

export interface ConfettiProps {
  /** `paper` (the default) drops rectangles and circles; `stars` drops five-pointed stars. */
  shape?: "paper" | "stars";
  /** Layout classes only (the box it falls inside). */
  className?: string;
}

export function Confetti({ shape = "paper", className }: ConfettiProps) {
  return (
    <span aria-hidden="true" className={cn("confetti pointer-events-none absolute inset-0 -z-10 overflow-hidden", shape === "stars" && "stars", className)}>
      {Array.from({ length: PIECES }, (_, i) => (
        <i
          key={i}
          /*
           * Each piece's place, pace and head start come from its index, so the
           * fall looks scattered without a random number that would differ
           * between a server render and the browser's.
           */
          style={
            {
              "--piece-left": `${(i * 6.3 + 3) % 100}%`,
              "--piece-ink": `var(--chart-${SERIES[i % SERIES.length]})`,
              "--piece-time": `${3.6 + ((i * 7) % 5) * 0.7}s`,
              "--piece-delay": `-${(i * 1.3) % 6}s`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}
