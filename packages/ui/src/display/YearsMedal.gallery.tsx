import type { GalleryEntry } from "../testing/gallery";
import { YearsMedal } from "./YearsMedal";

/* The medal sits on the work anniversary card's City Green. */
const onCard = (years: number | null) => (
  <div className="inline-flex rounded-sheet bg-secondary p-6">
    <YearsMedal years={years} />
  </div>
);

export default {
  component: "YearsMedal",
  states: {
    "Three Years": () => onCard(3),
    "One Year": () => onCard(1),
    "Ten Years": () => onCard(10),
    "Years Not Known": () => onCard(null),
  },
} satisfies GalleryEntry;
