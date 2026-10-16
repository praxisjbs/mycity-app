import type { GalleryEntry } from "../testing/gallery";
import { Timeline } from "./Timeline";

const ITEMS = [
  { title: "Submitted by Ada Obi", when: "13/10/2026 09:41", tone: "done" as const },
  { title: "Approved by Chidi Eze", when: "13/10/2026 11:02", text: "Within policy", tone: "done" as const },
  { title: "Waiting on Finance", when: "13/10/2026 11:03", tone: "now" as const },
  { title: "Payment", when: "Expected 25/10/2026" },
];

export default {
  component: "Timeline",
  states: {
    Default: () => <Timeline items={ITEMS} label="Claim History" />,
    "One Event": () => <Timeline items={[ITEMS[0]!]} />,
    "Without Tones": () => <Timeline items={ITEMS.map(({ tone: _tone, ...rest }) => rest)} />,
  },
} satisfies GalleryEntry;
