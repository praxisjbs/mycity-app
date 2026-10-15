import type { GalleryEntry } from "../testing/gallery";
import { Card, CardHeader } from "../layout/Card";
import { useGalleryFrame } from "../overlay/gallery-frame";
import { HelpTerm } from "./HelpTerm";

const GRACE = "Minutes past the shift start before a punch counts as late.";
const OVER_BY = "Hours worked beyond the rostered shift this week.";

function InTitle() {
  const [ref, frame] = useGalleryFrame();
  return (
    <div ref={ref}>
      <Card>
        <CardHeader title={<HelpTerm help={OVER_BY} container={frame}>Over By</HelpTerm>} />
        <p className="text-2xl font-strong">6.5 hours</p>
      </Card>
    </div>
  );
}

function InLabel() {
  const [ref, frame] = useGalleryFrame();
  return (
    <div ref={ref} className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-muted-foreground">
        <HelpTerm help={GRACE} container={frame}>
          Grace Period
        </HelpTerm>
      </span>
      <span className="text-sm">10 minutes</span>
    </div>
  );
}

function InHeader() {
  const [ref, frame] = useGalleryFrame();
  return (
    <div ref={ref} className="flex gap-6 text-xs font-semibold text-muted-foreground">
      <span data-ui="header">Employee</span>
      <span data-ui="header">
        <HelpTerm help="Clock events this month that a manager has not yet confirmed." side="bottom" container={frame}>
          Unconfirmed
        </HelpTerm>
      </span>
    </div>
  );
}

export default {
  component: "HelpTerm",
  states: {
    "Card Title": () => <InTitle />,
    "Field Label": () => <InLabel />,
    "Column Header": () => <InHeader />,
  },
} satisfies GalleryEntry;
