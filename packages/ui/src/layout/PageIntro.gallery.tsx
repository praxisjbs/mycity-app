import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { SiteSearch } from "../form/SiteSearch";
import { PageIntro } from "./PageIntro";

function WithSearch() {
  const [q, setQ] = useState("");
  return (
    <PageIntro
      eyebrow="Careers at MyCityApp"
      title="Open Roles"
      accent="Roles"
      text="12 roles across 7 teams, in Lagos and Abuja."
      aside={<SiteSearch tone="intro" label="Search Roles" placeholder="Role or City" value={q} onChange={setQ} />}
    />
  );
}

export default {
  component: "PageIntro",
  states: {
    "Open Roles": () => <WithSearch />,
    "Headline Only": () => <PageIntro eyebrow="Documents" title="Verify a Document" accent="Document" />,
  },
} satisfies GalleryEntry;
