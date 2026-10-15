import type { GalleryEntry } from "../testing/gallery";
import { Card } from "../layout/Card";
import { ErrorState } from "./ErrorState";

const retry = () => undefined;

export default {
  component: "ErrorState",
  states: {
    "Did Not Load": () => (
      <Card>
        <ErrorState error={{ status: 500, reference: "REF-7Q2K" }} onRetry={retry} />
      </Card>
    ),
    Offline: () => (
      <Card>
        <ErrorState error={{ status: 0 }} onRetry={retry} />
      </Card>
    ),
    "No Access": () => (
      <Card>
        <ErrorState error={{ status: 403 }} onRetry={retry} />
      </Card>
    ),
    "Whole Screen": () => <ErrorState page message="This screen hit a problem" onRetry={retry} />,
  },
} satisfies GalleryEntry;
