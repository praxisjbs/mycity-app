import type { GalleryEntry } from "../testing/gallery";
import { KeyValue } from "./KeyValue";

export default {
  component: "KeyValue",
  states: {
    Default: () => (
      <KeyValue
        items={[
          ["Department", "Field Sales"],
          ["Worksite", "MTN Head Office, Ikoyi"],
          ["Start Date", "13/10/2026"],
          ["Line Manager", "Adaeze Okafor"],
        ]}
      />
    ),
    "Not Set": () => (
      <KeyValue
        items={[
          ["Next of Kin", null],
          ["Bank", "GTBank, 0123456789"],
          ["End Date", ""],
        ]}
      />
    ),
    Stacked: () => (
      <KeyValue
        layout="stacked"
        items={[
          { label: "Leave Type", value: "Annual Leave" },
          { label: "Dates", value: "20/10/2026 to 24/10/2026" },
        ]}
      />
    ),
  },
} satisfies GalleryEntry;
