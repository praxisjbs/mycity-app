import type { GalleryEntry } from "../testing/gallery";
import { PullIndicator } from "./PullIndicator";
import type { PullState } from "./pull";

/** The top of a phone's page, the header's edge above it, with the indicator where the pull puts it. */
const page = (state: PullState, distance: number) => (
  <div className="relative h-36 w-72 overflow-hidden rounded-box border border-border bg-muted">
    <PullIndicator state={state} distance={distance} />
    <div className="flex flex-col gap-2 p-3 pt-24">
      <div className="h-10 rounded-box border border-border bg-card" />
    </div>
  </div>
);

export default {
  component: "PullIndicator",
  states: {
    "Being Pulled": () => page("pulling", 36),
    "Ring Closed": () => page("armed", 64),
    "Past the Second Notch": () => page("deep", 140),
    Refreshing: () => page("refreshing", 64),
    Done: () => page("done", 64),
  },
} satisfies GalleryEntry;
