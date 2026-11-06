import type { GalleryEntry } from "../testing/gallery";
import { RoleTile, RoleTiles } from "./RoleTile";

export default {
  component: "RoleTile",
  states: {
    "Closing Soon": () => (
      <RoleTiles label="Closing Soon">
        <RoleTile href="#/RoleTile" team="Operations & People" title="Operations Intern" line="Lekki Phase 1, Lagos. Closes 11/11/2026." />
        <RoleTile href="#/RoleTile" team="Marketing & Sales" title="Head, Sales & Revenue" line="Lekki Phase 1, Lagos. Closes 18/11/2026." />
        <RoleTile href="#/RoleTile" team="Studio" title="Graphics and Motion Designer" line="Ikeja, Lagos. Closes 20/11/2026." />
      </RoleTiles>
    ),
  },
} satisfies GalleryEntry;
