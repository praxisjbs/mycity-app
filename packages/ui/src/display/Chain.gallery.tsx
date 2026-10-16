import type { GalleryEntry } from "../testing/gallery";
import { Chain } from "./Chain";

export default {
  component: "Chain",
  states: {
    "In Progress": () => (
      <Chain
        steps={[
          { label: "Submitted", state: "done" },
          { label: "Line Manager", state: "done" },
          { label: "Finance", state: "now" },
          { label: "Payment" },
        ]}
      />
    ),
    Finished: () => (
      <Chain
        steps={[
          { label: "Submitted", state: "done" },
          { label: "Line Manager", state: "done" },
          { label: "Finance", state: "done" },
        ]}
      />
    ),
    "Not Started": () => <Chain steps={[{ label: "Submitted" }, { label: "Line Manager" }, { label: "Finance" }]} />,
  },
} satisfies GalleryEntry;
