import type { GalleryEntry } from "../testing/gallery";
import { SectionNav, type SectionNavItem } from "./SectionNav";

const HELP: SectionNavItem[] = [
  { id: "g-home", label: "The Front Page", icon: "home" },
  { id: "g-careers", label: "Open Roles", icon: "brief" },
  { id: "g-vacancy", label: "A Vacancy", icon: "brief" },
  { id: "g-apply", label: "Apply", icon: "doc" },
  { id: "g-assessment", label: "Assessment", icon: "check" },
  { id: "g-sign", label: "Sign Offer", icon: "signature" },
  { id: "g-verify", label: "Verify a Document", icon: "shield" },
];

export default {
  component: "SectionNav",
  states: {
    Column: () => (
      <div className="max-w-75">
        <SectionNav label="Help Contents" title="On This Page" items={HELP} />
      </div>
    ),
    Bar: () => <SectionNav variant="bar" label="Help Contents" items={HELP} />,
  },
} satisfies GalleryEntry;
