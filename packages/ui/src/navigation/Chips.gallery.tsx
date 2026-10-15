import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Chips } from "./Chips";

function Status() {
  const [status, setStatus] = useState("all");
  return (
    <Chips
      label="Status"
      value={status}
      onChange={setStatus}
      options={[
        { value: "all", label: "Everyone", count: 48 },
        { value: "late", label: "Late", count: 4 },
        { value: "remote", label: "Remote", count: 9 },
        { value: "leave", label: "On Leave", count: 3 },
        { value: "no_clockout", label: "No Clock Out", count: 1 },
      ]}
    />
  );
}

function Plain() {
  const [scope, setScope] = useState("all");
  return <Chips label="Queries" value={scope} onChange={setScope} options={[["all", "All Queries"], ["mine", "Raised by Me"]]} />;
}

function Toggle() {
  const [depts, setDepts] = useState<string[]>(["Operations"]);
  return (
    <Chips
      label="Departments"
      selected={depts}
      onSelectedChange={setDepts}
      options={["Operations", "People", "Finance", "Sales", "Technology"].map((d) => [d, d] as [string, string])}
    />
  );
}

export default {
  component: "Chips",
  states: {
    "With Counts": () => <Status />,
    "Single Select": () => <Plain />,
    Toggle: () => <Toggle />,
  },
} satisfies GalleryEntry;
