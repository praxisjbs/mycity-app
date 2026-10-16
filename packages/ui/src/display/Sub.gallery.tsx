import type { GalleryEntry } from "../testing/gallery";
import { Sub } from "./Sub";

export default {
  component: "Sub",
  states: {
    "In A Line": () => (
      <p className="text-sm">
        Adaeze Okonkwo <Sub record>Financial Controller</Sub>
      </p>
    ),
    "On Its Own": () => <Sub as="p">Updated 13/10/2026</Sub>,
  },
} satisfies GalleryEntry;
