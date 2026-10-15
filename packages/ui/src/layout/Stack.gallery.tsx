import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { Card } from "./Card";
import { Inline, Stack } from "./Stack";

export default {
  component: "Stack",
  states: {
    Stack: () => (
      <Stack>
        <Card>Personal</Card>
        <Card>Employment</Card>
        <Card>Next of Kin</Card>
      </Stack>
    ),
    Inline: () => (
      <Inline>
        <Button size="sm">Approve Leave</Button>
        <Button size="sm" variant="ghost">
          Decline Leave
        </Button>
      </Inline>
    ),
    "Spread Apart": () => (
      <Inline justify="between">
        <span className="text-sm">Annual Leave</span>
        <span className="text-sm font-strong">18 days</span>
      </Inline>
    ),
  },
} satisfies GalleryEntry;
