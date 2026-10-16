import type { GalleryEntry } from "../testing/gallery";
import { Brand } from "./Brand";

export default {
  component: "Brand",
  states: {
    "Pin Alone": () => <Brand />,
    "With Name": () => <Brand name="MyCityApp" />,
    Sizes: () => (
      <div className="flex items-end gap-4">
        <Brand size="s" />
        <Brand size="m" />
        <Brand size="l" />
        <Brand size="xl" />
      </div>
    ),
    "On Deep Green": () => (
      <div className="on-dark flex items-center gap-4 rounded-box bg-sidebar p-4">
        <Brand tone="on-dark" size="l" />
        <Brand tone="on-dark" name="MyCity App" />
      </div>
    ),
  },
} satisfies GalleryEntry;
