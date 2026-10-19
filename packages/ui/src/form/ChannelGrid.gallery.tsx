import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { ChannelGrid, type ChannelGridRow } from "./ChannelGrid";

const COLUMNS = [
  { key: "in_app", label: "In App" },
  { key: "email", label: "Email" },
  { key: "push", label: "Push" },
];

const START: ChannelGridRow[] = [
  { key: "security", label: "Security", values: { in_app: true, email: true, push: true }, locked: { in_app: true, email: true, push: true } },
  { key: "approvals", label: "Approvals", values: { in_app: true, email: true, push: true } },
  { key: "comms", label: "Messages and Mail", values: { in_app: true, email: false, push: true } },
  { key: "people", label: "Attendance and Leave", values: { in_app: true, email: false, push: false } },
];

function Live() {
  const [rows, setRows] = useState(START);
  return (
    <ChannelGrid
      label="Where Notices Reach You"
      columns={COLUMNS}
      rows={rows}
      onChange={(row, column, on) => setRows((rs) => rs.map((r) => (r.key === row ? { ...r, values: { ...r.values, [column]: on } } : r)))}
    />
  );
}

export default {
  component: "ChannelGrid",
  states: {
    Categories: () => <Live />,
  },
} satisfies GalleryEntry;
