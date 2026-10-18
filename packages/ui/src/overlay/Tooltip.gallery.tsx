import type { GalleryEntry } from "../testing/gallery";
import { Tooltip } from "./Tooltip";
import { useGalleryFrame } from "./gallery-frame";

const NAMES = ["Offer Letter Adaeze Okafor Signed.pdf", "Lekki Phase One Worksite Survey.pdf"];

function Row({ side }: { side?: "top" | "bottom" }) {
  const [ref, frame] = useGalleryFrame();
  return (
    <div ref={ref} className="flex flex-col gap-2 py-6">
      {NAMES.map((name) => (
        <Tooltip key={name} label={name} side={side} container={frame}>
          <span tabIndex={0} data-copy="content" className="block w-48 truncate text-sm">
            {name}
          </span>
        </Tooltip>
      ))}
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
