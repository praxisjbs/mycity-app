import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Countdown } from "./Countdown";

/** A clock that ends `seconds` from when the state opens, as a fresh session answer would set it. */
function Clock({ seconds, warnAt, ring }: { seconds: number; warnAt?: number; ring?: boolean }) {
  const [t] = useState(() => {
    const now = Date.now();
    return { now: new Date(now).toISOString(), end: new Date(now + seconds * 1000).toISOString() };
  });
  return <Countdown endsAt={t.end} serverNow={t.now} warnAt={warnAt} {...(ring ? { look: "ring" as const, total: 3600 } : {})} />;
}

export default {
  component: "Countdown",
  states: {
    "Plenty Left": () => <Clock seconds={45 * 60} />,
    "Over an Hour": () => <Clock seconds={90 * 60} />,
    "Five Minutes": () => <Clock seconds={4 * 60 + 30} />,
    "Last Minute": () => <Clock seconds={40} />,
    "Time Up": () => <Clock seconds={0} />,
    "Ring, an Hour": () => <Clock seconds={59 * 60 + 42} ring />,
    "Ring, Last Minutes": () => <Clock seconds={4 * 60} ring />,
  },
} satisfies GalleryEntry;
