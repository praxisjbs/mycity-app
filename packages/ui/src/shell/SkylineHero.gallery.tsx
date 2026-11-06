import type { GalleryEntry } from "../testing/gallery";
import { ProgressBar } from "../display/ProgressBar";
import { SkylineHero } from "./SkylineHero";

export default {
  component: "SkylineHero",
  states: {
    "Careers Front Door": () => (
      <SkylineHero eyebrow="Careers at MyCityApp" title="Work With Us" text="Building the app that knows every Nigerian city." still />
    ),
    "A Role": () => (
      <SkylineHero
        size="m"
        eyebrow="Marketing & Sales"
        title="Partnerships Associate"
        facts={[
          { icon: "pin", text: "Lagos" },
          { icon: "building", text: "Hybrid, 2 days in office" },
          { icon: "brief", text: "Full Time" },
        ]}
        still
      />
    ),
    "Context Pane": () => (
      <SkylineHero size="pane" eyebrow="Graphics and Motion Design" title="Question 2 of 7" still>
        <ProgressBar label="1 of 7 Answered" value={1} max={7} showValue={false} tone="ok" />
      </SkylineHero>
    ),
  },
} satisfies GalleryEntry;
