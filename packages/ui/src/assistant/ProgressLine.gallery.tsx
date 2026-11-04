import type { GalleryEntry } from "../testing/gallery";
import { ProgressLine } from "./ProgressLine";

export default {
  component: "ProgressLine",
  states: {
    "First Read": () => <ProgressLine words="leave requests" step={{ n: 1, of: 5 }} />,
    "Later Read": () => <ProgressLine words="employees" step={{ n: 3, of: 5 }} />,
    "Nothing Known Yet": () => <ProgressLine />,
  },
} satisfies GalleryEntry;
