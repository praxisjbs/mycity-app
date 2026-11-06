import type { GalleryEntry } from "../testing/gallery";
import { CountUp } from "./CountUp";

export default {
  component: "CountUp",
  states: {
    "Open Roles": () => (
      <span className="text-4xl font-strong">
        <CountUp value={12} delay={500} />
      </span>
    ),
    "Three Figures": () => (
      <span className="flex gap-10 text-3xl font-strong">
        <CountUp value={12} delay={500} />
        <CountUp value={7} delay={620} />
        <CountUp value={2} delay={740} />
      </span>
    ),
  },
} satisfies GalleryEntry;
