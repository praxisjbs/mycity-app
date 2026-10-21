import type { GalleryEntry } from "../testing/gallery";
import { ThemePreview } from "./ThemePreview";

export default {
  component: "ThemePreview",
  states: {
    "Dark Theme": () => <ThemePreview label="Preview, Deep Green" className="max-w-md" />,
    "Other Faces": () => (
      <ThemePreview
        label="Preview, Deep Green in system faces"
        faces={{ heading: "ui-serif, Georgia, serif", body: "ui-sans-serif, system-ui, sans-serif" }}
        className="max-w-md"
      />
    ),
  },
} satisfies GalleryEntry;
