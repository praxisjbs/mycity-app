import type { GalleryEntry } from "../testing/gallery";
import { ProgressBar } from "../display/ProgressBar";
import { Button } from "../actions/Button";
import { SiteSearch } from "../form/SiteSearch";
import { SkylineHero } from "./SkylineHero";

export default {
  component: "SkylineHero",
  states: {
    "The Index": () => (
      <SkylineHero
        size="index"
        eyebrow="Hiring in Lagos and Abuja"
        title="Work With Us"
        accent="Us"
        text="Building the app that knows every Nigerian city."
        stats={[
          { value: 12, label: "Open Roles" },
          { value: 7, label: "Teams Hiring" },
          { value: 2, label: "Cities" },
        ]}
        still
      >
        <SiteSearch label="Search Roles" placeholder="Role or City" value="" onChange={() => undefined} onSubmit={() => undefined} />
      </SkylineHero>
    ),
    "A Role Page": () => (
      <SkylineHero
        size="role"
        record
        back={{ label: "All Roles", href: "#/SkylineHero" }}
        eyebrow="Marketing & Sales"
        title="Head, Sales & Revenue"
        facts={[
          { icon: "pin", text: "Lekki Phase 1, Lagos" },
          { icon: "building", text: "Hybrid, 2 days in office" },
          { icon: "brief", text: "Full Time" },
          { icon: "calendar", text: "Closes 18/11/2026" },
        ]}
        note="12 people have applied"
        still
      >
        <Button variant="primary" size="lg">
          Apply Now
        </Button>
        <Button variant="glass" size="lg" icon="share">
          Share Role
        </Button>
      </SkylineHero>
    ),
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
