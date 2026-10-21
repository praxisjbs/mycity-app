import type { GalleryEntry } from "../testing/gallery";
import { UrgentBar } from "./UrgentBar";

const wait = () => new Promise((resolve) => setTimeout(resolve, 600));

export default {
  component: "UrgentBar",
  states: {
    "Urgent Announcement": () => <UrgentBar title="Fire drill at 11" actionLabel="Acknowledge" onAction={wait} onOpen={() => undefined} />,
    "Several Waiting": () => (
      <UrgentBar
        title="Overdue approval: Leave request"
        position={2}
        count={3}
        actionLabel="Open"
        onAction={wait}
        onOpen={() => undefined}
        onPrevious={() => undefined}
        onNext={() => undefined}
      />
    ),
  },
} satisfies GalleryEntry;
