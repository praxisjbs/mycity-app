import type { GalleryEntry } from "../testing/gallery";
import { SAMPLE_IMAGE } from "../documents/fixtures";
import { LinkCard } from "./LinkCard";

const CARD = {
  href: "https://nfelia.com/lagos",
  title: "Ember to Remember: the Lagos leg",
  site: "Nfelia",
  description: "Stage build, schedule and the brands taking part this December.",
};

export default {
  component: "LinkCard",
  states: {
    "Wide Picture": () => <LinkCard {...CARD} image={SAMPLE_IMAGE} hasImage imageWidth={1200} imageHeight={630} />,
    "Small Picture": () => <LinkCard {...CARD} image={SAMPLE_IMAGE} hasImage imageWidth={300} imageHeight={300} />,
    "No Picture": () => <LinkCard {...CARD} description={null} />,
    "In The Composer": () => <LinkCard {...CARD} tone="plain" image={SAMPLE_IMAGE} hasImage imageWidth={300} imageHeight={300} onRemove={() => undefined} />,
    Loading: () => <LinkCard href={CARD.href} tone="plain" loading onRemove={() => undefined} />,
  },
} satisfies GalleryEntry;
