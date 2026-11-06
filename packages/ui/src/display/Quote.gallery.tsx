import type { GalleryEntry } from "../testing/gallery";
import { Quote } from "./Quote";

export default {
  component: "Quote",
  states: {
    Default: () => <Quote>Please share the handover notes before you go.</Quote>,
    "With Author": () => <Quote cite="Adaeze Okafor, Line Manager">Approved, enjoy the break.</Quote>,
    "Site Feature": () => (
      <Quote look="feature" lead="A commercial leader, not simply a sales administrator.">
        Someone who can find opportunities, open doors, build relationships, negotiate, close deals and build a high-performing sales engine around them.
      </Quote>
    ),
  },
} satisfies GalleryEntry;
