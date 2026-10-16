import type { GalleryEntry } from "../testing/gallery";
import { ImageViewer } from "./ImageViewer";
import { SAMPLE_IMAGE } from "./fixtures";

export default {
  component: "ImageViewer",
  states: {
    Default: () => <ImageViewer src={SAMPLE_IMAGE} alt="Receipt.jpg" height="sm" />,
    Taller: () => <ImageViewer src={SAMPLE_IMAGE} alt="Worksite.jpg" />,
    "Inside A Frame": () => <ImageViewer src={SAMPLE_IMAGE} alt="Receipt.jpg" height="sm" noOpen />,
  },
} satisfies GalleryEntry;
