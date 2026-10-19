import type { GalleryEntry } from "../testing/gallery";
import { ExportButton } from "./ExportButton";

const wait = () => new Promise((resolve) => setTimeout(resolve, 900));

export default {
  component: "ExportButton",
  states: {
    Default: () => <ExportButton onExport={wait} />,
    "Own Label": () => <ExportButton onExport={wait} message="Payslips downloaded">Export Payslips</ExportButton>,
  },
} satisfies GalleryEntry;
