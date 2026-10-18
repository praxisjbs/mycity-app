import type { GalleryEntry } from "../testing/gallery";
import { LevelMeter } from "./LevelMeter";

/** The access levels a role may hold on a module, lowest first. */
const LEVELS = [
  ["No Access", 0],
  ["View", 1],
  ["Add", 2],
  ["Edit", 3],
  ["Full", 4],
] as const;

export default {
  component: "LevelMeter",
  states: {
    Levels: () => (
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {LEVELS.map(([name, value]) => (
          <li key={name} className="flex items-center gap-2 text-sm">
            <LevelMeter value={value} label={name} />
            <span>{name}</span>
          </li>
        ))}
      </ul>
    ),
    Decorative: () => (
      <div className="flex max-w-xs items-center justify-between gap-4 text-sm">
        <span className="font-semibold">Payroll</span>
        <span className="flex items-center gap-2">
          <LevelMeter value={3} label="Edit" decorative />
          <span>Edit</span>
        </span>
      </div>
    ),
  },
} satisfies GalleryEntry;
