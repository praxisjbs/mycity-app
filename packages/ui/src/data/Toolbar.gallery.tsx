import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { SearchInput } from "../form/SearchInput";
import { FilterSelect } from "../form/SearchInput";
import { Toolbar } from "./Toolbar";

const Filters = () => {
  const [q, setQ] = useState("");
  const [department, setDepartment] = useState("");
  return (
    <Toolbar label="Employees">
      <SearchInput value={q} onChange={setQ} placeholder="Search People" className="w-56" />
      <FilterSelect
        label="Department"
        value={department}
        onChange={setDepartment}
        options={[
          ["", "All Departments"],
          ["finance", "Finance"],
          ["people", "People"],
        ]}
      />
      <Button icon="download">Export</Button>
    </Toolbar>
  );
};

export default {
  component: "Toolbar",
  states: {
    "Search Only": () => (
      <Toolbar label="Leave Requests">
        <SearchInput value="" onChange={() => undefined} placeholder="Search People" className="w-56" />
      </Toolbar>
    ),
    "With Filters": Filters,
  },
} satisfies GalleryEntry;
