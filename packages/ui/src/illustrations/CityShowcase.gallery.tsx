import type { GalleryEntry } from "../testing/gallery";
import { Brand } from "../shell/Brand";
import { CityShowcase } from "./CityShowcase";

export default {
  component: "CityShowcase",
  states: {
    "Sign-In Panel": () => (
      <CityShowcase className="h-140 rounded-card">
        <Brand tone="on-dark" size="l" name="MyCity App" />
      </CityShowcase>
    ),
    "From London": () => <CityShowcase start="london" className="h-120 rounded-card" />,
    "Phone Band": () => <CityShowcase variant="band" start="nairobi" className="h-52 max-w-sm rounded-card" />,
  },
} satisfies GalleryEntry;
