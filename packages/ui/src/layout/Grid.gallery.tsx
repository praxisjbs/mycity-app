import type { GalleryEntry } from "../testing/gallery";
import { Card, CardHeader } from "./Card";
import { Grid } from "./Grid";

const tile = (label: string) => (
  <Card key={label}>
    <p className="text-sm text-muted-foreground">{label}</p>
  </Card>
);

export default {
  component: "Grid",
  states: {
    "Four Columns": () => <Grid cols={4}>{["Present", "Late", "Absent", "On Leave"].map(tile)}</Grid>,
    "Two on Phone": () => (
      <Grid cols={4} phoneCols={2}>
        {["Entitlement", "Taken", "Booked", "Left"].map(tile)}
      </Grid>
    ),
    "Two Columns": () => <Grid cols={2}>{["Personal", "Employment"].map(tile)}</Grid>,
    "Two Scrolling Columns": () => (
      <Grid cols={2}>
        <Card>
          <p className="text-sm text-muted-foreground">Sessions and Passwords</p>
        </Card>
        <Card>
          <CardHeader title="Two-Step by Role" />
          {Array.from({ length: 30 }, (_, i) => (
            <p key={i} className="border-b border-border py-2 text-sm">Role {i + 1}</p>
          ))}
        </Card>
      </Grid>
    ),
    "Wide and Narrow": () => <Grid cols="1.4/1">{["Requests", "Request Detail"].map(tile)}</Grid>,
    "Narrow and Wide": () => <Grid cols="1/1.5">{["Departments", "Team Roster"].map(tile)}</Grid>,
  },
} satisfies GalleryEntry;
