import type { GalleryEntry } from "../testing/gallery";
import { Money } from "./Money";

export default {
  component: "Money",
  states: {
    Default: () => <Money value="1250000.00" />,
    Negative: () => <Money value="-45000.00" />,
    "KPI Short": () => <Money value="1342500.00" short className="text-3xl font-strong" />,
    "Not Set": () => <Money value={null} />,
  },
} satisfies GalleryEntry;
