import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { FilterSelect, SearchInput } from "./SearchInput";

function Search() {
  const [q, setQ] = useState("");
  return <SearchInput label="Search Employees" placeholder="Name or Email" value={q} onChange={setQ} />;
}

function Filter() {
  const [v, setV] = useState("");
  return <FilterSelect label="Status" value={v} onChange={setV} options={[["", "All"], ["present", "Present"], ["late", "Late"], ["absent", "Absent"]]} />;
}

export default {
  component: "SearchInput",
  states: {
    Search: () => <Search />,
    Filter: () => <Filter />,
  },
} satisfies GalleryEntry;
