import type { GalleryEntry } from "../testing/gallery";
import { Card, CardHeader } from "./Card";
import { StickyColumns } from "./StickyColumns";

const lines = ["Role Overview", "Required Experience", "Key Responsibilities", "Working Days", "Reporting Line", "Probation"];

export default {
  component: "StickyColumns",
  states: {
    "Text and Its Card": () => (
      <StickyColumns layout="main-side" phoneFirst={1}>
        <div className="flex flex-col gap-6">
          {lines.map((l) => (
            <Card key={l} as="section">
              <CardHeader title={l} />
              <p className="text-sm text-muted-foreground">Lagos, Hybrid, Full Time</p>
            </Card>
          ))}
        </div>
        <Card as="section">
          <CardHeader title="The Role" />
          <p className="text-sm text-muted-foreground">Full Time</p>
        </Card>
      </StickyColumns>
    ),
    "Pane and Form": () => (
      <StickyColumns>
        <Card as="section">
          <CardHeader title="Your Application" />
        </Card>
        <Card as="section">
          <CardHeader title="Contact Details" />
          <p className="text-sm text-muted-foreground">Full Name, Email, Phone</p>
        </Card>
      </StickyColumns>
    ),
  },
} satisfies GalleryEntry;
