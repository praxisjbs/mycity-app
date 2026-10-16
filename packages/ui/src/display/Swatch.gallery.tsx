import type { GalleryEntry } from "../testing/gallery";
import { Swatch } from "./Swatch";

const PALETTE = [
  ["--primary", "Primary Yellow"],
  ["--secondary", "City Green"],
  ["--deep", "Deep Green"],
  ["--success", "Success"],
  ["--warning", "Warning"],
  ["--destructive", "Error"],
];

export default {
  component: "Swatch",
  states: {
    Palette: () => (
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {PALETTE.map(([token, name]) => (
          <li key={token} className="flex items-center gap-2.5">
            <Swatch token={token!} />
            <span className="text-sm font-semibold">{name}</span>
            <code className="ml-auto text-2xs text-subtle-foreground">{token}</code>
          </li>
        ))}
      </ul>
    ),
    "Chart Series": () => (
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <Swatch key={n} token={`--chart-${n}`} size="sm" />
        ))}
      </div>
    ),
  },
} satisfies GalleryEntry;
