import type { GalleryEntry } from "../testing/gallery";
import { FormatButton } from "./FormatButton";

const wait = () => new Promise((resolve) => setTimeout(resolve, 900));
const name = (f: string) => `Export ${f.toUpperCase()}`;

export default {
  component: "FormatButton",
  states: {
    "Two Formats": () => <FormatButton label="Export" formats={["pdf", "xlsx"]} onRun={wait} item={name} size="md" />,
    "One Format": () => <FormatButton label="Run Now" formats={["xlsx"]} onRun={wait} item={name} />,
    Busy: () => <FormatButton label="Export" formats={["pdf", "xlsx"]} onRun={wait} item={name} busy size="md" />,
  },
} satisfies GalleryEntry;
