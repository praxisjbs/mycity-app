import type { GalleryEntry } from "../testing/gallery";
import { BarChart } from "./BarChart";
import { CLAIMS, DEPARTMENTS, MONTH_OF_DAYS, MONTHS } from "./fixtures";

export default {
  component: "BarChart",
  states: {
    Default: () => <BarChart title="Claims by Month" bars={MONTHS.map((label, i) => ({ label, value: CLAIMS[i]! }))} caption="Approved claims only" />,
    "Colour per Bar": () => <BarChart title="Headcount" bars={DEPARTMENTS} colourPerBar />,
    "One Bar Apart": () => (
      <BarChart title="Claims by Month" bars={MONTHS.map((label, i) => ({ label, value: CLAIMS[i]!, ...(label === "May" ? { series: 4 as const } : {}) }))} />
    ),
    "Single Bar": () => <BarChart title="Open Queries" bars={[{ label: "Open", value: 4 }]} />,
    "Month of Days": () => <BarChart title="Spend by Day" bars={MONTH_OF_DAYS} />,
  },
} satisfies GalleryEntry;
