import type { GalleryEntry } from "../testing/gallery";
import { IconList } from "./IconList";

export default {
  component: "IconList",
  states: {
    "A Role's KPIs": () => (
      <IconList
        icon="trend"
        label="Key Performance Indicators (KPIs)"
        items={["Revenue against target", "New clients and merchants", "Value of closed deals", "Sales pipeline value", "Lead-to-client conversion", "Client retention"]}
      />
    ),
  },
} satisfies GalleryEntry;
