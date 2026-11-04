import type { GalleryEntry } from "../testing/gallery";
import { SourcesPane } from "./SourcesPane";
import type { PaneRead } from "./pane";

const READS: PaneRead[] = [
  { n: 1, name: "Leave Requests", kind: "read", outcome: "read", filters: [["Status", "waiting"]], rows: 25, total: 312, masked: [], opens: true },
  { n: 2, name: "Employees", kind: "read", outcome: "read", filters: [["Department", "Operations"]], rows: 8, total: 8, masked: ["salary", "bank"], opens: true },
  { n: 3, name: "Attendance Summary", kind: "summary", outcome: "read", filters: [["Month", "2026-10"]], rows: 0, total: 40, masked: [] },
  { n: 4, name: "Payroll Runs", kind: "read", outcome: "refused", filters: [], rows: 0, total: null, masked: [] },
];

export default {
  component: "SourcesPane",
  states: {
    "Four Reads": () => <SourcesPane reads={READS} when="22/10/2026 09:30" onOpenTable={() => undefined} />,
    "One Read": () => <SourcesPane reads={READS.slice(0, 1)} onOpenTable={() => undefined} />,
    "No Reads Made": () => <SourcesPane reads={[]} />,
  },
} satisfies GalleryEntry;
