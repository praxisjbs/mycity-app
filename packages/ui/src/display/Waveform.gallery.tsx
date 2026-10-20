import { useEffect, useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Icon } from "../icons/Icon";
import { Waveform } from "./Waveform";

/** A spoken sentence's rise and fall, as the worker measures one. */
const SPEECH = Array.from({ length: 48 }, (_, i) => Math.round(20 + 75 * Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.23))));

const Playing = () => {
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const tick = setInterval(() => setAt((s) => (s >= 42 ? 0 : s + 0.25)), 250);
    return () => clearInterval(tick);
  }, [playing]);
  return (
    <div className="flex min-w-48 max-w-80 items-center gap-2 rounded-card border border-border bg-card p-3">
      <button
        type="button"
        onClick={() => setPlaying((p) => !p)}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        className="flex size-7.5 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground phone:size-tap"
      >
        <Icon name={playing ? "pause" : "play"} />
      </button>
      <Waveform seconds={42} peaks={SPEECH} progress={at / 42} />
      <em className="text-2xs not-italic opacity-80">0:42</em>
    </div>
  );
};

export default {
  component: "Waveform",
  states: {
    Playing,
    Still: () => <Waveform seconds={42} peaks={SPEECH} className="max-w-80" />,
    "Half Played": () => <Waveform seconds={42} peaks={SPEECH} progress={0.5} className="max-w-80" />,
    "Not Yet Measured": () => <Waveform seconds={6} playing className="max-w-80" />,
  },
} satisfies GalleryEntry;
