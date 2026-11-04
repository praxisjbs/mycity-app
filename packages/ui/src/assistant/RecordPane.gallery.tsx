import type { GalleryEntry } from "../testing/gallery";
import { RecordPane } from "./RecordPane";

export default {
  component: "RecordPane",
  states: {
    "A Record": () => <RecordPane record={{ title: "Ayo Bello", items: [["Leave Type", "Annual"], ["Days", "3"], ["Starts", "27/10/2026"], ["Status", "Waiting"]], link: "/people?tab=leave&id=l1" }} onOpen={() => undefined} />,
    "No Screen": () => <RecordPane record={{ title: "Recognition posted", items: [["When", "11:20"], ["By", "Ngozi Eze"]], link: null }} />,
    "No Record Open": () => <RecordPane record={null} />,
  },
} satisfies GalleryEntry;
