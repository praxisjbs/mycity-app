import type { GalleryEntry } from "../testing/gallery";
import { BandChart } from "./BandChart";
import { GRADES } from "./fixtures";

export default {
  component: "BandChart",
  states: {
    Default: () => <BandChart title="Salary Structure" scale="₦0 to ₦5M" rows={GRADES} caption="Midpoints marked" />,
    "One Grade": () => <BandChart title="Salary Structure" scale="₦0 to ₦5M" rows={[GRADES[1]!]} />,
    "Own Series": () => <BandChart title="Salary Structure" scale="₦0 to ₦5M" rows={GRADES.map((g, i) => ({ ...g, series: ((i % 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6 }))} />,
  },
} satisfies GalleryEntry;
