import type { GalleryEntry } from "../testing/gallery";
import { GuideBody, type GuideBlock } from "./GuideBody";
import { GUIDE_BLOCKS, GUIDE_PICTURE } from "./fixtures";

const blocks = GUIDE_BLOCKS as GuideBlock[];

export default {
  component: "GuideBody",
  states: {
    Default: () => <GuideBody blocks={blocks} anchor="people-add-employee" picture={() => GUIDE_PICTURE} onZoom={() => undefined} />,
    "Came Back": () => <GuideBody blocks={blocks} anchor="people-add-employee" picture={() => GUIDE_PICTURE} highlight={2} />,
    "No Picture Yet": () => <GuideBody blocks={blocks} anchor="people-add-employee" />,
  },
} satisfies GalleryEntry;
