import type { GalleryEntry } from "../testing/gallery";
import { TrendChart } from "./TrendChart";

const HOURS = Array.from({ length: 24 }, (_, i) => `20/10/2026 ${String(i).padStart(2, "0")}:00`);
const TICKS = HOURS.map((h) => h.slice(11));
const wave = (i: number, low: number, high: number) => Math.round(low + ((Math.sin(i / 3) + 1) / 2) * (high - low));
const P95 = HOURS.map((_, i) => (i === 9 || i === 10 ? null : wave(i, 180, i === 15 ? 1100 : 520)));
const MEAN = HOURS.map((_, i) => (i === 9 || i === 10 ? null : wave(i, 45, 140)));

export default {
  component: "TrendChart",
  states: {
    Default: () => (
      <TrendChart
        title="Response Time"
        labels={HOURS}
        ticks={TICKS}
        lines={[
          { name: "p95", values: P95 },
          { name: "Mean", values: MEAN, series: 3 },
        ]}
        target={{ value: 800, label: "Target 800 ms" }}
        format={(v) => `${Math.round(v)} ms`}
      />
    ),
    "Shares of a Whole": () => (
      <TrendChart
        title="Processor"
        labels={HOURS}
        ticks={TICKS}
        max={100}
        lines={[
          { name: "Busy", values: HOURS.map((_, i) => wave(i, 9, 61)) },
          { name: "Steal", values: HOURS.map((_, i) => wave(i, 0, 3)), series: 4 },
          { name: "I/O Wait", values: HOURS.map((_, i) => wave(i, 0, 5)), series: 5 },
        ]}
        format={(v) => `${Math.round(v)}%`}
      />
    ),
    "With Help": () => (
      <TrendChart
        title="People Online"
        help="How many people had the app open, by the hour."
        labels={HOURS}
        ticks={TICKS}
        lines={[{ name: "Online", values: HOURS.map((_, i) => wave(i, 2, 31)), series: 3 }]}
      />
    ),
  },
} satisfies GalleryEntry;
