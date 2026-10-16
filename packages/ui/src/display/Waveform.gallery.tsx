import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Icon } from "../icons/Icon";
import { Waveform } from "./Waveform";

const Playing = () => {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="flex min-w-48 max-w-80 items-center gap-2 rounded-card border border-border bg-card p-3">
      <button
        type="button"
        onClick={() => setPlaying((p) => !p)}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        className="flex size-7.5 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground"
      >
        <Icon name={playing ? "pause" : "play"} />
      </button>
      <Waveform seconds={42} playing={playing} />
      <em className="text-2xs not-italic opacity-80">0:42</em>
    </div>
  );
};

export default {
  component: "Waveform",
  states: {
    Playing,
    Still: () => <Waveform seconds={42} className="max-w-80" />,
    "Short Note": () => <Waveform seconds={6} playing className="max-w-80" />,
  },
} satisfies GalleryEntry;
