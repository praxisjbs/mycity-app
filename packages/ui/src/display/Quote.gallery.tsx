import type { GalleryEntry } from "../testing/gallery";
import { Quote } from "./Quote";

export default {
  component: "Quote",
  states: {
    Default: () => <Quote>Please share the handover notes before you go.</Quote>,
    "With Author": () => <Quote cite="Adaeze Okafor, Line Manager">Approved, enjoy the break.</Quote>,
  },
} satisfies GalleryEntry;
