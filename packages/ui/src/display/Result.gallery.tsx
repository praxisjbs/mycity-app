import type { GalleryEntry } from "../testing/gallery";
import { Result } from "./Result";

export default {
  component: "Result",
  states: {
    Done: () => <Result tone="ok" label="Clocked In" title="07:52, On Site" text="Lekki Office" />,
    Warning: () => <Result tone="warn" label="Late" title="09:21, On Site" text="22 minutes past your shift start" />,
    Failed: () => <Result tone="err" label="Not Clocked In" title="No Location" text="Turn location on and try again" />,
    News: () => <Result tone="info" label="Signed" title="Offer Accepted" icon="doc" />,
  },
} satisfies GalleryEntry;
