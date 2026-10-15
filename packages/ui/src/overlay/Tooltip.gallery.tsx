import type { GalleryEntry } from "../testing/gallery";
import { IconButton } from "../actions/Button";
import { Tooltip } from "./Tooltip";
import { useGalleryFrame } from "./gallery-frame";

function Row({ side }: { side?: "top" | "bottom" }) {
  const [ref, frame] = useGalleryFrame();
  return (
    <div ref={ref} className="flex items-center gap-2 py-6">
      <Tooltip label="Search" side={side} container={frame}>
        <IconButton icon="srch" label="Search" />
      </Tooltip>
      <Tooltip label="Notifications" side={side} container={frame}>
        <IconButton icon="bell" label="Notifications" dot />
      </Tooltip>
      <Tooltip label="More Actions" side={side} container={frame}>
        <IconButton icon="dots" label="More Actions" />
      </Tooltip>
    </div>
  );
}

export default {
  component: "Tooltip",
  states: {
    Below: () => <Row />,
    Above: () => <Row side="top" />,
  },
} satisfies GalleryEntry;
