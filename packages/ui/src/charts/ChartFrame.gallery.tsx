import type { GalleryEntry } from "../testing/gallery";
import { ChartFrame } from "./ChartFrame";
import { Pill } from "../display/Pill";

const drawing = <div className="flex h-40 items-center justify-center rounded-box bg-muted text-2xs text-subtle-foreground">The drawing goes here</div>;

export default {
  component: "ChartFrame",
  states: {
    Default: () => (
      <ChartFrame title="Attendance" values={[{ label: "Mon", value: "22" }, { label: "Tue", value: "21" }]}>
        {drawing}
      </ChartFrame>
    ),
    "With Everything": () => (
      <ChartFrame
        title="Attendance"
        help="How many people clocked in on each working day this month."
        actions={<Pill tone="ok">This Month</Pill>}
        caption="Dips are Saturdays, a half day"
        values={[{ label: "Mon", value: "22" }]}
      >
        {drawing}
      </ChartFrame>
    ),
    "No Title": () => <ChartFrame label="Attendance This Month">{drawing}</ChartFrame>,
  },
} satisfies GalleryEntry;
