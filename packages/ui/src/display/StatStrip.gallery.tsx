import type { GalleryEntry } from "../testing/gallery";
import { StatStrip } from "./StatStrip";

export default {
  component: "StatStrip",
  states: {
    Default: () => (
      <StatStrip
        label="Claim Figures"
        items={[
          { label: "Submitted", value: 18 },
          { label: "Approved", value: 14, tone: "ok" },
          { label: "Queried", value: 3, tone: "warn" },
          { label: "Declined", value: 1, tone: "err" },
        ]}
      />
    ),
    "Six Figures": () => (
      <StatStrip
        label="Pipeline Figures"
        items={[
          { label: "Leads", value: 42 },
          { label: "Qualified", value: 18 },
          { label: "Proposals Out", value: 7 },
          { label: "Signed", value: 4, tone: "ok" },
          { label: "Average Days", value: "21.4" },
          { label: "Quiet Partners", value: 4, desktop: true, tone: "warn" },
        ]}
      />
    ),
    Opening: () => (
      <StatStrip
        label="Claim Figures"
        items={[
          { label: "Queried", value: 3, tone: "warn", onOpen: () => undefined, action: "View All" },
          { label: "Approved", value: 14, tone: "ok" },
        ]}
      />
    ),
  },
} satisfies GalleryEntry;
