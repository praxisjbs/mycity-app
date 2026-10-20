import type { GalleryEntry } from "../testing/gallery";
import { PdfViewer } from "./PdfViewer";
import { samplePdfBlob } from "./fixtures";

/* One set of bytes for the page: a new Blob on every render would open the PDF again each time. */
const SAMPLE = samplePdfBlob();

export default {
  component: "PdfViewer",
  states: {
    Default: () => <PdfViewer data={SAMPLE} name="Receipt.pdf" height="sm" />,
    Opening: () => <PdfViewer data={null} name="Receipt.pdf" height="sm" />,
    "On Deep Green": () => (
      <div className="h-64 bg-deep">
        <PdfViewer data={SAMPLE} name="Receipt.pdf" height="fill" tone="deep" />
      </div>
    ),
  },
} satisfies GalleryEntry;
