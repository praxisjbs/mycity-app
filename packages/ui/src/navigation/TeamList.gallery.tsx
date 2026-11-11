import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { TeamList } from "./TeamList";

function Teams() {
  const [value, setValue] = useState("");
  return (
    <div className="max-w-75">
      <TeamList
        label="Teams"
        value={value}
        onChange={setValue}
        items={[
          { value: "", label: "All Teams", count: 12 },
          { value: "CNT", label: "Content", count: 2 },
          { value: "ENG", label: "Engineering", count: 1 },
          { value: "MKT", label: "Marketing & Sales", count: 4 },
          { value: "STU", label: "Studio", count: 2 },
        ]}
      />
    </div>
  );
}

export default {
  component: "TeamList",
  states: {
    "All Teams": () => <Teams />,
  },
} satisfies GalleryEntry;
