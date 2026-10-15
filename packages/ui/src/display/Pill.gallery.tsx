import type { GalleryEntry } from "../testing/gallery";
import { Pill, StatusPill } from "./Pill";

export default {
  component: "Pill",
  states: {
    Tones: () => (
      <div className="flex flex-wrap gap-2">
        <Pill tone="ok">Approved</Pill>
        <Pill tone="warn">Pending</Pill>
        <Pill tone="err">Declined</Pill>
        <Pill tone="info">Draft</Pill>
        <Pill>Closed</Pill>
      </div>
    ),
    "Without Dot": () => <Pill dot={false}>Annual Leave</Pill>,
    "Status Pill": () => <StatusPill status={{ tone: "warn", text: "Awaiting Manager" }} />,
  },
} satisfies GalleryEntry;
