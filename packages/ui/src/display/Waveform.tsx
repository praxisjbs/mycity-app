/**
 * @component Waveform
 * @group Display
 * @summary A voice note's bars, which fill as it plays.
 * @use Beside the play button on a voice note: a community message, a review's dictated comment.
 * @avoid A real reading of the audio (these bars are a shape, not the sound); a progress figure a person reads (use ProgressBar).
 * @phone The same bars at the width the bubble gives them; the play button beside it keeps its 44 px.
 * @a11y Decorative: the length is said in words beside it and the button says whether it is playing, so nothing here needs reading.
 * @status stable
 * @example <Waveform seconds={42} playing={playing} />
 */
import type { CSSProperties } from "react";
import { cn } from "../lib/cn";

/** How many bars a note gets, whatever its length. */
const BARS = 26;

/** The shortest and the tallest bar, in pixels. */
const SHORTEST = 5;
const RANGE = 17;

export interface WaveformProps {
  /** How long the note is, in seconds: it sets how fast the bars fill. */
  seconds: number;
  /** It is playing: the bars light in turn over the note's length. */
  playing?: boolean;
  /** Layout classes only (width, height). */
  className?: string;
}

export function Waveform({ seconds, playing, className }: WaveformProps) {
  return (
    <span aria-hidden="true" className={cn("flex h-6 flex-1 items-center gap-0.5", className)}>
      {Array.from({ length: BARS }, (_, bar) => (
        <i
          key={bar}
          /*
           * A bar's height comes from its own index, so the shape is steady
           * rather than random, and its delay spreads the fill over the note's
           * length. Both are CSS variables the classes read.
           */
          style={
            {
              "--bar-height": `${SHORTEST + ((bar * 37) % RANGE)}px`,
              "--bar-delay": playing ? `${(bar * seconds) / BARS}s` : "0s",
              "--bar-time": playing ? `${seconds / BARS}s` : "var(--dur)",
            } as CSSProperties
          }
          className={cn("w-0.5 rounded-sm bg-current transition-opacity delay-(--bar-delay) duration-(--bar-time) h-(--bar-height)", playing ? "opacity-100" : "opacity-55")}
        />
      ))}
    </span>
  );
}
