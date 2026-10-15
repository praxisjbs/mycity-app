import type { GalleryEntry } from "../testing/gallery";
import { Card } from "./Card";
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
    "Wide and Narrow": () => <Grid cols="1.4/1">{["Requests", "Request Detail"].map(tile)}</Grid>,
    "Narrow and Wide": () => <Grid cols="1/1.5">{["Departments", "Team Roster"].map(tile)}</Grid>,
  },
} satisfies GalleryEntry;
