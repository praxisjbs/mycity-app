import type { GalleryEntry } from "../testing/gallery";
import { Bars } from "./Bars";

const PIPELINE = [
  { label: "Leads", percent: 100, value: "42 leads" },
  { label: "Qualified", percent: 43, value: "18 leads" },
  { label: "Proposals Out", percent: 17, value: "7 leads" },
  { label: "Signed", percent: 9, value: "4 leads" },
];

export default {
  component: "Bars",
  states: {
    Default: () => <Bars rows={PIPELINE} note="Last 30 days" />,
    "Own Series": () => <Bars rows={PIPELINE.map((r, i) => ({ ...r, series: ((i % 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6 }))} />,
    "One Row": () => <Bars rows={[PIPELINE[1]!]} />,
  },
} satisfies GalleryEntry;
