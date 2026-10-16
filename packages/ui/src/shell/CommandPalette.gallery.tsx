import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { useGalleryFrame } from "../overlay/gallery-frame";
import { SearchButton } from "./TopBar";
import { CommandPalette } from "./CommandPalette";
import { PALETTE_RESULTS } from "./fixtures";

function Opens({ empty }: { empty?: boolean }) {
  const [ref, frame] = useGalleryFrame();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const results = empty ? [] : PALETTE_RESULTS.filter((r) => r.title.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div ref={ref}>
      <SearchButton onClick={() => setOpen(true)} />
      <CommandPalette open={open} onClose={() => setOpen(false)} query={q} onQueryChange={setQ} results={results} onSelect={() => undefined} container={frame} />
    </div>
  );
}

export default {
  component: "CommandPalette",
  states: {
    Results: () => <Opens />,
    "Nothing Found": () => <Opens empty />,
  },
} satisfies GalleryEntry;
