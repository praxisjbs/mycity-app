import type { GalleryEntry } from "../testing/gallery";
import { Card, CardHeader } from "../layout/Card";
import { useGalleryFrame } from "../overlay/gallery-frame";
import { Details } from "./Details";

function Schedule() {
  const [ref, frame] = useGalleryFrame();
  return (
    <div ref={ref}>
      <Card
        details={
          <Details
            title="Work Schedule"
            container={frame}
            items={[
              ["Grace Period", "10 minutes"],
              ["Counts From", "Shift start"],
              ["Overtime After", "8 hours"],
            ]}
          />
        }
      >
        <CardHeader title="Work Schedule" />
        <p className="text-sm">Monday to Friday, 08:00 to 17:00</p>
      </Card>
    </div>
  );
}

function WithLine() {
  const [ref, frame] = useGalleryFrame();
  return (
    <div ref={ref}>
      <Card details={<Details title="Leave Balance" container={frame} items={[["Carry Over", "Up to 5 days"], ["Expires", "31/03/2027"]]}>Unused days beyond the carry over lapse at year end.</Details>}>
        <CardHeader title="Leave Balance" />
        <p className="text-2xl font-strong">12 days</p>
      </Card>
    </div>
  );
}

export default {
  component: "Details",
  states: {
    "Label Value Pairs": () => <Schedule />,
    "With a Line": () => <WithLine />,
  },
} satisfies GalleryEntry;
