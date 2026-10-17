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
    Phone: () => (
      <CityShowcase variant="phone" start="johannesburg" className="h-180 max-w-sm rounded-card" aside={<p className="py-24 text-center text-muted-foreground">Sign-in form</p>}>
        <Brand tone="on-dark" name="MyCity App" />
      </CityShowcase>
    ),
  },
} satisfies GalleryEntry;
