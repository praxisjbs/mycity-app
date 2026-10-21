import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { useGalleryFrame } from "../overlay/gallery-frame";
import { NavCapsule } from "./NavCapsule";
import { TRAIL_ITEMS } from "./fixtures";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The capsule as the top bar holds it: hold Refresh for the ring, hold or right click an arrow for the trail. */
function Capsule({ arrows = true, back = "Employees", forward = "Runs" }: { arrows?: boolean; back?: string | null; forward?: string | null }) {
  const [ref, frame] = useGalleryFrame();
  const [reloads, setReloads] = useState(0);
  return (
    <div ref={ref} className="flex items-center gap-3">
      <NavCapsule
        arrows={arrows}
        back={back}
        forward={forward}
        onBack={() => undefined}
        onForward={() => undefined}
        onRefresh={() => wait(900)}
        onReload={() => setReloads((n) => n + 1)}
        trail={TRAIL_ITEMS}
        onGo={() => undefined}
        container={frame}
      />
      {reloads > 0 && <span className="text-xs text-subtle-foreground">Reloaded {reloads}</span>}
    </div>
  );
}

export default {
  component: "NavCapsule",
  states: {
    "Installed App": () => <Capsule />,
    "Nothing Ahead": () => <Capsule forward={null} />,
    "Browser Tab": () => <Capsule arrows={false} />,
  },
} satisfies GalleryEntry;
