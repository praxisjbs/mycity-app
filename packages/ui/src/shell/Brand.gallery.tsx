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
    "Public Site Tile": () => (
      <div className="flex flex-wrap items-center gap-8">
        <Brand name="MyCityApp" sub="Careers" tile="deep" />
        <span className="on-dark rounded-box bg-deep p-4" data-theme="dark">
          <Brand name="MyCityApp" tile="secondary" />
        </span>
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
