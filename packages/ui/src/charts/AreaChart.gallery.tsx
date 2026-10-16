import type { GalleryEntry } from "../testing/gallery";
import { AreaChart } from "./AreaChart";
import { PRESENT, WORKING_DAYS } from "./fixtures";

export default {
  component: "AreaChart",
  states: {
    Default: () => <AreaChart title="Attendance" labels={WORKING_DAYS} values={PRESENT} caption="Dips are Saturdays, a half day" />,
    "With Help": () => (
      <AreaChart title="Attendance" help="How many people clocked in on each working day this month." labels={WORKING_DAYS} values={PRESENT} />
    ),
    "Second Series": () => <AreaChart title="Signed Value" labels={["Jan", "Feb", "Mar", "Apr"]} values={[2, 5, 4, 8]} series={2} format={(v) => `₦${v}M`} />,
    Bare: () => <AreaChart label="Attendance" labels={WORKING_DAYS} values={PRESENT} bare />,
    "One Point": () => <AreaChart title="Attendance" labels={["Today"]} values={[46]} />,
  },
} satisfies GalleryEntry;
