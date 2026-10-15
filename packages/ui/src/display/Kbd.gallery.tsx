import type { GalleryEntry } from "../testing/gallery";
import { Kbd } from "./Kbd";

export default {
  component: "Kbd",
  states: {
    "One Key": () => <Kbd>Esc</Kbd>,
    Combination: () => <Kbd keys={["⌘", "K"]} label="Command K" />,
    "In a Menu": () => (
      <p className="flex items-center gap-3 text-sm">
        Search <Kbd keys={["Ctrl", "K"]} />
      </p>
    ),
  },
} satisfies GalleryEntry;
