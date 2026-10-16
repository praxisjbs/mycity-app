import type { GalleryEntry } from "../testing/gallery";
import { KeyValue } from "../display/KeyValue";
import { Sparkline } from "./Sparkline";
import { CLAIMS, PRESENT } from "./fixtures";

export default {
  component: "Sparkline",
  states: {
    Default: () => <Sparkline label="Attendance" values={PRESENT} />,
    Rising: () => <Sparkline label="Signed Value" values={[2, 3, 5, 6, 9]} series={2} />,
    Flat: () => <Sparkline label="Open Queries" values={[4, 4, 4, 4]} series={3} />,
    "Beside A Figure": () => (
      <KeyValue
        items={[
          ["Claims", <Sparkline key="c" label="Claims" values={CLAIMS} />],
          ["Attendance", <Sparkline key="a" label="Attendance" values={PRESENT} />],
        ]}
      />
    ),
  },
} satisfies GalleryEntry;
