import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { Popover } from "./Popover";
import { useGalleryFrame } from "./gallery-frame";

function Filters({ align }: { align?: "start" | "end" }) {
  const [ref, frame] = useGalleryFrame();
  return (
    <div ref={ref} className={align === "end" ? "flex justify-end" : undefined}>
      <Popover title="Filter Leave" align={align} container={frame} trigger={<Button icon="flag">Filters</Button>}>
        {(close) => (
          <div className="flex flex-col gap-2">
            <Button onClick={close}>Annual Leave</Button>
            <Button onClick={close}>Sick Leave</Button>
            <Button onClick={close}>Study Leave</Button>
          </div>
        )}
      </Popover>
    </div>
  );
}

export default {
  component: "Popover",
  states: {
    Default: () => <Filters />,
    "Aligned End": () => <Filters align="end" />,
  },
} satisfies GalleryEntry;
