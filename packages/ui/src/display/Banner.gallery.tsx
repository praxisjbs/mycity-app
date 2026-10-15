import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { Banner } from "./Banner";

export default {
  component: "Banner",
  states: {
    Warning: () => (
      <Banner tone="warn" icon="doc" action={<Button size="sm">Read Policy</Button>}>
        Attendance policy updated on 13/10/2026
      </Banner>
    ),
    Information: () => <Banner tone="info">You have three registered devices</Banner>,
    Success: () => <Banner tone="ok">Clocked in at 08:04, Lekki Worksite</Banner>,
    Error: () => (
      <Banner tone="err" action={<Button size="sm">Retry Run</Button>}>
        October payroll run failed
      </Banner>
    ),
  },
} satisfies GalleryEntry;
