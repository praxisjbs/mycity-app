import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { SiteSearch } from "./SiteSearch";

function Search({ tone }: { tone: "hero" | "intro" }) {
  const [q, setQ] = useState("");
  return <SiteSearch tone={tone} label="Search Roles" placeholder="Role or City" value={q} onChange={setQ} onSubmit={() => undefined} />;
}

export default {
  component: "SiteSearch",
  states: {
    "On the Hero": () => (
      <div className="flex justify-center rounded-sheet bg-deep px-4 py-10">
        <Search tone="hero" />
      </div>
    ),
    "Beside a Headline": () => <Search tone="intro" />,
  },
} satisfies GalleryEntry;
