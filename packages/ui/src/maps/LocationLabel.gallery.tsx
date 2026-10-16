import type { GalleryEntry } from "../testing/gallery";
import { KeyValue } from "../display/KeyValue";
import { LocationLabel } from "./LocationLabel";
import { IKEJA, LEKKI, sampleResolve } from "./fixtures";

export default {
  component: "LocationLabel",
  states: {
    "Looking Up": () => <LocationLabel point={LEKKI} resolve={sampleResolve} />,
    "Already Known": () => <LocationLabel point={LEKKI} label="12 Admiralty Way, Lekki Phase 1, Lagos" />,
    "Coordinates Only": () => <LocationLabel point={IKEJA} />,
    "In A Row": () => (
      <KeyValue
        items={[
          ["Clock In", <LocationLabel key="in" bare point={LEKKI} resolve={sampleResolve} />],
          ["Clock Out", <LocationLabel key="out" bare point={IKEJA} resolve={sampleResolve} />],
        ]}
      />
    ),
  },
} satisfies GalleryEntry;
