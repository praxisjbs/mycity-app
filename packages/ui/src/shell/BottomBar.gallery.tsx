import type { GalleryEntry } from "../testing/gallery";
import { BottomBar } from "./BottomBar";
import { BOTTOM_ITEMS } from "./fixtures";

export default {
  component: "BottomBar",
  states: {
    Home: () => <BottomBar items={BOTTOM_ITEMS(() => undefined)} current="home" />,
    "More Open": () => <BottomBar items={BOTTOM_ITEMS(() => undefined, true)} current="more" />,
  },
} satisfies GalleryEntry;
