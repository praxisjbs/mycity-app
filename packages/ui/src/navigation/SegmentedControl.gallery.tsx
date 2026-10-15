import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { SegmentedControl } from "./SegmentedControl";

function Scope() {
  const [scope, setScope] = useState("mine");
  return <SegmentedControl label="Whose Tasks" value={scope} onChange={setScope} options={[["mine", "Mine"], ["team", "My Team"]]} />;
}

function Period({ small }: { small?: boolean }) {
  const [period, setPeriod] = useState("month");
  return (
    <SegmentedControl
      label="Period"
      small={small}
      value={period}
      onChange={setPeriod}
      disabled={["quarter"]}
      options={[
        { value: "week", label: "Week" },
        { value: "month", label: "Month" },
        { value: "quarter", label: "Quarter" },
        { value: "year", label: "Year" },
      ]}
    />
  );
}

function Views() {
  const [view, setView] = useState("register");
  return (
    <SegmentedControl
      label="Attendance View"
      value={view}
      onChange={setView}
      options={[
        { value: "register", label: "Register" },
        { value: "assignments", label: "Field Assignments", count: 3 },
        { value: "requests", label: "Location Requests", count: 12 },
        { value: "manager", label: "Manager Preview" },
      ]}
    />
  );
}

export default {
  component: "SegmentedControl",
  states: {
    "Two Views": () => <Scope />,
    "With Disabled": () => <Period />,
    Small: () => <Period small />,
    "Four With Counts": () => <Views />,
  },
} satisfies GalleryEntry;
