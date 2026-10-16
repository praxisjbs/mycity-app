import type { GalleryEntry } from "../testing/gallery";
import { Grid } from "../layout/Grid";
import { Pill } from "./Pill";
import { Tile } from "./Tile";

export default {
  component: "Tile",
  states: {
    Default: () => (
      <Tile title="Attendance Month" text="Every clocking for one month.">
        <Pill>Excel</Pill>
        <Pill>PDF</Pill>
      </Tile>
    ),
    "In A Grid": () => (
      <Grid cols={3}>
        <Tile title="Attendance Month" text="Every clocking for one month." />
        <Tile title="Leave Balances" text="Everyone's days left, by type." />
        <Tile title="Payroll Register" text="One run, line by line." />
      </Grid>
    ),
    "Title Only": () => <Tile title="Leave Balances" />,
  },
} satisfies GalleryEntry;
