import type { GalleryEntry } from "../testing/gallery";
import { StackBar } from "./StackBar";

export default {
  component: "StackBar",
  states: {
    Default: () => (
      <StackBar
        label="Memory"
        total={18432}
        parts={[
          { key: "production", label: "Production", value: 1946, figure: "1.9 GB" },
          { key: "staging", label: "Staging", value: 819, figure: "0.8 GB" },
          { key: "database", label: "Database", value: 1638, figure: "1.6 GB" },
          { key: "redis", label: "Redis", value: 205, figure: "0.2 GB" },
          { key: "other", label: "Other", value: 614, figure: "0.6 GB", series: 6 },
          { key: "cache", label: "Cache", value: 9626, figure: "9.4 GB", series: "muted" },
        ]}
        rest={{ label: "Free", figure: "3.5 GB" }}
      />
    ),
    "Disk by Use": () => (
      <StackBar
        label="Disk"
        total={241000}
        parts={[
          { key: "production_database", label: "Production Database", value: 3100, figure: "3 GB" },
          { key: "production_files", label: "Production Files", value: 8200, figure: "8 GB" },
          { key: "staging", label: "Staging", value: 2050, figure: "2 GB" },
          { key: "backups", label: "Backups", value: 6150, figure: "6 GB" },
          { key: "system", label: "System", value: 5100, figure: "5 GB", series: "muted" },
        ]}
        rest={{ label: "Left", figure: "212 GB" }}
      />
    ),
    "No Key": () => <StackBar label="Processor" total={100} legend={false} parts={[{ key: "production", label: "Production", value: 12, figure: "12%" }]} />,
  },
} satisfies GalleryEntry;
