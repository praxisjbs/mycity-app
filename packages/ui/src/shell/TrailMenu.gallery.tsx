import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { useGalleryFrame } from "../overlay/gallery-frame";
import { TrailMenu } from "./TrailMenu";
import { TRAIL_ITEMS } from "./fixtures";

/** The trail behind a button: under it on desktop, a sheet on a phone. */
function Trail({ items = TRAIL_ITEMS }: { items?: typeof TRAIL_ITEMS }) {
  const [ref, frame] = useGalleryFrame();
  const [open, setOpen] = useState(false);
  return (
    <div ref={ref}>
      <TrailMenu open={open} onOpenChange={setOpen} items={items} onGo={() => undefined} container={frame}>
        <Button icon="history" onClick={() => setOpen(true)}>
          Show Trail
        </Button>
      </TrailMenu>
    </div>
  );
}

export default {
  component: "TrailMenu",
  states: {
    "Five Places": () => <Trail />,
    "Nothing Ahead": () => <Trail items={TRAIL_ITEMS.slice(1)} />,
  },
} satisfies GalleryEntry;
