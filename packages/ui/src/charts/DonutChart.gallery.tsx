import type { GalleryEntry } from "../testing/gallery";
import { DonutChart } from "./DonutChart";

export default {
  component: "DonutChart",
  states: {
    "One Share": () => <DonutChart title="On Time" percent={77} middle="77%" under="on time" lines={["37 on time", "4 late", "7 absent"]} />,
    Slices: () => (
      <DonutChart
        title="Goals This Quarter"
        middle="14"
        under="met"
        slices={[
          { label: "Met", value: 14 },
          { label: "In Progress", value: 6 },
          { label: "Missed", value: 3 },
        ]}
        lines={["14 met", "6 in progress", "3 missed"]}
      />
    ),
    "No Lines": () => <DonutChart title="Budget Drawn" percent={62} middle="₦3.1M" under="of ₦5M" />,
    Empty: () => <DonutChart title="On Time" percent={0} middle="0%" under="on time" lines={["Nothing recorded yet"]} />,
  },
} satisfies GalleryEntry;
