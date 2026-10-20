import type { GalleryEntry } from "../testing/gallery";
import { FileCard } from "./FileCard";
import { SAMPLE_IMAGE } from "./fixtures";

export default {
  component: "FileCard",
  states: {
    "PDF With Page": () => <FileCard name="Lagos call sheet.pdf" mime="application/pdf" sizeBytes={245_000} pages={3} hasPreview preview={SAMPLE_IMAGE} onDownload={() => undefined} />,
    "Page Loading": () => <FileCard name="Offer letter.pdf" mime="application/pdf" sizeBytes={88_000} hasPreview onDownload={() => undefined} />,
    Spreadsheet: () => <FileCard name="Q4 budget.xlsx" mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" sizeBytes={41_000} onDownload={() => undefined} />,
    "On The Page": () => <FileCard name="Stage plan.pptx" mime="application/vnd.openxmlformats-officedocument.presentationml.presentation" sizeBytes={1_200_000} tone="plain" onDownload={() => undefined} />,
  },
} satisfies GalleryEntry;
