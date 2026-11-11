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
    Stacked: () => (
      <Chain
        stack
        label="Run Route"
        steps={[
          { label: "Draft", state: "done" },
          { label: "Computed", state: "done" },
          { label: "Submitted", state: "now" },
          { label: "Approved" },
          { label: "Paid" },
        ]}
      />
    ),
    "Not Started": () => <Chain steps={[{ label: "Submitted" }, { label: "Line Manager" }, { label: "Finance" }]} />,
  },
} satisfies GalleryEntry;
