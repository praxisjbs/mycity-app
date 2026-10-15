import type { GalleryEntry } from "../testing/gallery";
import { EmptyValue } from "./EmptyValue";

export default {
  component: "EmptyValue",
  states: {
    Default: () => <EmptyValue />,
    "In a Row": () => (
      <p className="flex gap-3 text-sm">
        <span className="text-muted-foreground">End Date</span>
        <EmptyValue label="No end date" />
      </p>
    ),
  },
} satisfies GalleryEntry;
