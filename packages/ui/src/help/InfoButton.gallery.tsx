import type { GalleryEntry } from "../testing/gallery";
import { Card, CardHeader } from "../layout/Card";
import { useGalleryFrame } from "../overlay/gallery-frame";
import { InfoButton } from "./InfoButton";

function OnChart() {
  const [ref, frame] = useGalleryFrame();
  return (
    <div ref={ref}>
      <Card>
        <CardHeader
          title="Overtime"
          help={<InfoButton label="Overtime Trend" help="Hours past the rostered shift, by week, for the last 12 weeks." container={frame} />}
        />
        <div aria-hidden="true" className="h-24 rounded-box bg-muted" />
      </Card>
    </div>
  );
}

function Alone() {
  const [ref, frame] = useGalleryFrame();
  return (
    <div ref={ref} className="flex items-center gap-2 text-sm">
      <span className="text-2xl font-strong">92%</span>
      <InfoButton label="On Time Rate" help="Punches inside the grace period, out of all punches this month." container={frame} />
    </div>
  );
}

export default {
  component: "InfoButton",
  states: {
    "Beside a Chart": () => <OnChart />,
    "Beside a Figure": () => <Alone />,
  },
} satisfies GalleryEntry;
