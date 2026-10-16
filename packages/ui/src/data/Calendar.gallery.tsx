import type { GalleryEntry } from "../testing/gallery";
import { Calendar } from "./Calendar";

const EVENTS = [
  { date: "2026-10-05", label: "Ada on leave" },
  { date: "2026-10-06", label: "Ada on leave" },
  { date: "2026-10-14", label: "Interviews" },
  { date: "2026-10-23", label: "Payroll run", highlight: true },
  { date: "2026-10-25", label: "Payday", highlight: true },
];

export default {
  component: "Calendar",
  states: {
    Default: () => <Calendar year={2026} month={9} events={EVENTS} />,
    Opening: () => <Calendar year={2026} month={9} events={EVENTS.map((e) => ({ ...e, onSelect: () => undefined }))} />,
    "Nothing On": () => <Calendar year={2026} month={10} events={[]} />,
    February: () => <Calendar year={2026} month={1} events={[{ date: "2026-02-25", label: "Payday", highlight: true }]} />,
  },
} satisfies GalleryEntry;
