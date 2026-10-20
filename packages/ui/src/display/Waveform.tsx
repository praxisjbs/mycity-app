/**
 * @component Waveform
 * @group Display
 * @summary A voice note's bars, drawn from its measured loudness, which fill as it plays.
 * @use Beside the play button on a voice note: a community message, a review's dictated comment.
 * @avoid A progress figure a person reads (use ProgressBar); measuring the audio in the browser (the worker measures it once, as `waveform`).
 * @phone The same bars at the width the bubble gives them; the play button beside it keeps its 44 px.
 * @a11y Decorative: the length is said in words beside it and the button says whether it is playing, so nothing here needs reading.
 * @status stable
 * @example <Waveform seconds={42} peaks={note.document.waveform} progress={position / 42} />
 */
import type { CSSProperties } from "react";
import { cn } from "../lib/cn";

/** How many bars a note gets, whatever its length. */
const BARS = 32;

/** The shortest and the tallest bar, in pixels. */
const SHORTEST = 4;
const RANGE = 18;

export interface WaveformProps {
  /** How long the note is, in seconds: without `progress`, it sets how fast the bars fill. */
  seconds: number;
  /** The note's loudness, each 0 to 100 (the worker's `waveform`); a steady shape stands in until it is measured. */
  peaks?: number[] | null;
  /** How far it has played, 0 to 1, read from the audio itself; the bars up to it are lit. */
  progress?: number;
  /** It is playing: without `progress`, the bars light in turn over the note's length. */
  playing?: boolean;
  /** Layout classes only (width, height). */
  className?: string;
}

/** The loudness of each bar, 0 to 100: the loudest reading in its share of `peaks`. */
function barLevels(peaks: number[] | null | undefined): number[] {
  if (!peaks?.length) return Array.from({ length: BARS }, (_, bar) => ((bar * 37) % 17) * (100 / 16));
  return Array.from({ length: BARS }, (_, bar) => {
    const from = Math.floor((bar * peaks.length) / BARS);
    const to = Math.max(from + 1, Math.floor(((bar + 1) * peaks.length) / BARS));
    return Math.max(...peaks.slice(from, to));
  });
}

export function Waveform({ seconds, peaks, progress, playing, className }: WaveformProps) {
  const levels = barLevels(peaks);
  const following = progress !== undefined;
  const lit = following ? Math.round(Math.min(1, Math.max(0, progress)) * BARS) : 0;
  return (
    <span aria-hidden="true" className={cn("flex h-6 flex-1 items-center gap-0.5", className)}>
      {levels.map((level, bar) => {
        const on = following ? bar < lit : playing;
        return (
          <i
            key={bar}
            /*
             * A bar's height is its loudness and is set as a CSS variable the classes read.
             * Following the audio, a bar lights once the sound reaches it; otherwise its delay
             * spreads the fill over the note's length.
             */
            style={
              {
                "--bar-height": `${SHORTEST + Math.round((level / 100) * RANGE)}px`,
                "--bar-delay": !following && playing ? `${(bar * seconds) / BARS}s` : "0s",
                "--bar-time": !following && playing ? `${seconds / BARS}s` : "var(--dur)",
              } as CSSProperties
            }
            className={cn("w-0.5 rounded-sm bg-current transition-opacity delay-(--bar-delay) duration-(--bar-time) h-(--bar-height)", on ? "opacity-100" : "opacity-55")}
          />
        );
      })}
    </span>
  );
}
