import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import type { DataViewList } from "../data/DataView";
import { Icon } from "../icons/Icon";
import { RecordPicker } from "./RecordPicker";
import { SAMPLE_SITES, type SampleSite } from "./fixtures";

function useSites(total = SAMPLE_SITES.length): DataViewList<SampleSite> {
  const [q, setQ] = useState("");
  const rows = SAMPLE_SITES.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()));
  return { rows, page: { number: 1, size: 25, total, pages: 1, has_next: false }, loading: false, error: null, q, setQ };
}

const One = () => {
  const [value, setValue] = useState<SampleSite[]>([]);
  return (
    <RecordPicker
      list={useSites()}
      value={value}
      onChange={setValue}
      id={(s) => s.worksite_id}
      title={(s) => s.name}
      sub={(s) => s.area}
      lead={() => <Icon name="pin" size="m" className="text-subtle-foreground" />}
      placeholder="Search Sites"
    />
  );
};

const Several = () => {
  const [value, setValue] = useState<SampleSite[]>([SAMPLE_SITES[0]!]);
  return (
    <RecordPicker list={useSites()} value={value} onChange={setValue} id={(s) => s.worksite_id} title={(s) => s.name} sub={(s) => s.area} multiple placeholder="Search Sites" />
  );
};

const Longer = () => {
  const [value, setValue] = useState<SampleSite[]>([]);
  return <RecordPicker list={useSites(312)} value={value} onChange={setValue} id={(s) => s.worksite_id} title={(s) => s.name} sub={(s) => s.area} placeholder="Search Sites" />;
};

export default {
  component: "RecordPicker",
  states: { "One Record": One, "Several Records": Several, "Longer List": Longer },
} satisfies GalleryEntry;
