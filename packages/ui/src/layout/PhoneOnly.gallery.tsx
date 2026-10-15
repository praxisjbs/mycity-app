import type { GalleryEntry } from "../testing/gallery";
import { Card } from "./Card";
import { DesktopOnly, PhoneOnly } from "./PhoneOnly";

export default {
  component: "PhoneOnly",
  states: {
    "Phone Only": () => (
      <PhoneOnly>
        <Card>Shown on a Phone</Card>
      </PhoneOnly>
    ),
    "Desktop Only": () => (
      <DesktopOnly>
        <Card>Shown on Desktop</Card>
      </DesktopOnly>
    ),
  },
} satisfies GalleryEntry;
