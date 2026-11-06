import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { SectionHead } from "./SectionHead";

export default {
  component: "SectionHead",
  states: {
    Centred: () => <SectionHead kicker="How We Hire" title="Four Steps, Every Time" text="The same fair process for every role and every candidate." />,
    "Split With an Action": () => (
      <SectionHead
        align="split"
        eyebrow="Careers"
        title="Closing Soon"
        accent="Soon"
        action={
          <Button variant="line" size="lg">
            See All Roles
          </Button>
        }
      />
    ),
  },
} satisfies GalleryEntry;
