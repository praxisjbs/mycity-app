import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { EmptyState } from "./EmptyState";

export default {
  component: "EmptyState",
  states: {
    Default: () => (
      <EmptyState
        title="No Requests Yet"
        text="Your leave requests appear here"
        action={
          <Button variant="primary" icon="plus">
            Request Leave
          </Button>
        }
      />
    ),
    "No Matches": () => <EmptyState illustration="Search" title="No Matches" text="Try another name or department" />,
    "First Run": () => (
      <EmptyState
        illustration="FirstRun"
        title="No Worksites Yet"
        action={
          <Button variant="primary" icon="plus">
            Add Worksite
          </Button>
        }
      />
    ),
    Locked: () => <EmptyState illustration="Locked" title="Not Open to You" text="Ask People for access" />,
    Offline: () => <EmptyState illustration="Offline" title="No Connection" text="Check your connection, then retry" />,
    Bare: () => <EmptyState bare illustration="ClockIn" title="No Clock Events Today" />,
  },
} satisfies GalleryEntry;
