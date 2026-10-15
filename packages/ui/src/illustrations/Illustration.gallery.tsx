import type { GalleryEntry } from "../testing/gallery";
import { ILLUSTRATION_NAMES, Illustration } from "./Illustration";

export default {
  component: "Illustration",
  states: {
    "All Drawings": () => (
      <div className="grid grid-cols-3 gap-4">
        {ILLUSTRATION_NAMES.map((n) => (
          <Illustration key={n} name={n} label={n} />
        ))}
      </div>
    ),
    Small: () => <Illustration name="Search" size="s" />,
    Large: () => <Illustration name="ClockIn" size="l" />,
  },
} satisfies GalleryEntry;
