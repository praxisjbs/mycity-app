import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { ComingSoon } from "./ComingSoon";

export default {
  component: "ComingSoon",
  states: {
    "Staff Preview": () => (
      <ComingSoon
        milestone="Milestone 2 · 06/11/2026"
        line="Opens with Milestone 2, Productivity and Performance."
        features={["Your KPIs for the month, weighted to 100%", "The goal chain above your KPI", "Self rating first, then your manager"]}
        action={<Button>See Full Design</Button>}
      />
    ),
    Production: () => <ComingSoon milestone="Milestone 1 · 30/10/2026" line="Opens with Milestone 1." />,
    "Public Visitor": () => <ComingSoon line="Careers opens here soon." features={["Every open role at MyCity App, in one list"]} />,
  },
} satisfies GalleryEntry;
