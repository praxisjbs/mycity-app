import type { GalleryEntry } from "../testing/gallery";
import { KpiGrid } from "./KpiGrid";

const FOUR = [
  { key: "in", title: "Clocked In Today", value: "22 of 25", caption: "3 late" },
  { key: "site", title: "On Site", value: 14 },
  { key: "remote", title: "Remote", value: 8 },
  { key: "leave", title: "On Leave", value: 2, tone: "warn" as const },
];

export default {
  component: "KpiGrid",
  states: {
    "Four Figures": () => <KpiGrid items={FOUR} />,
    "Three Figures": () => <KpiGrid items={FOUR.slice(0, 3)} cols={3} />,
    "Two Figures": () => <KpiGrid items={FOUR.slice(0, 2)} cols={2} />,
    Opening: () => <KpiGrid items={FOUR.map((f) => ({ ...f, onOpen: () => undefined }))} />,
  },
} satisfies GalleryEntry;
