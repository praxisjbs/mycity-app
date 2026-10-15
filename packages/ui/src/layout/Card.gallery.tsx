import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { Card, CardHeader } from "./Card";

export default {
  component: "Card",
  states: {
    Default: () => (
      <Card>
        <CardHeader title="Leave Balance" />
        <p className="text-3xl font-strong">18 days</p>
      </Card>
    ),
    "With Actions": () => (
      <Card>
        <CardHeader
          title="Leave Requests"
          actions={
            <Button size="sm" variant="ghost" iconRight="right">
              View All
            </Button>
          }
        />
        <p>Annual Leave, 20/10/2026 to 24/10/2026</p>
      </Card>
    ),
    "With Details": () => (
      <Card details={<p className="py-2 text-sm text-muted-foreground">Grace period 10 minutes</p>}>
        <CardHeader title="Work Schedule" />
        <p>Monday to Friday, 08:00 to 17:00</p>
      </Card>
    ),
    "No Padding": () => (
      <Card pad={false}>
        <div className="bg-muted p-6 text-center text-sm">Lekki Worksite</div>
      </Card>
    ),
  },
} satisfies GalleryEntry;
