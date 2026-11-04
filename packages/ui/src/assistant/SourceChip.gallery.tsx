import type { GalleryEntry } from "../testing/gallery";
import { SourceChip } from "./SourceChip";

const Row = ({ selected }: { selected?: boolean }) => (
  <div className="flex flex-wrap gap-1.5">
    <SourceChip label="partnership" count={4} onSelect={() => undefined} selected={selected} />
    <SourceChip label="interaction log" count={1} onSelect={() => undefined} />
    <SourceChip label="employee" count={2} onSelect={() => undefined} />
  </div>
);

export default {
  component: "SourceChip",
  states: {
    "Kinds of Record": () => <Row />,
    "One Selected": () => <Row selected />,
    "One Record": () => <SourceChip kind="record" label="Ayo Bello" onSelect={() => undefined} />,
    "Plain Label": () => <SourceChip label="employee" count={3} />,
  },
} satisfies GalleryEntry;
