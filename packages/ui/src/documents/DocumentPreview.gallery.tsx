import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { DocumentPreview } from "./DocumentPreview";
import { SAMPLE_IMAGE, SAMPLE_PDF } from "./fixtures";

export default {
  component: "DocumentPreview",
  states: {
    "A PDF": () => <DocumentPreview name="Receipt.pdf" mime="application/pdf" href={SAMPLE_PDF} sizeBytes={48213} height="sm" />,
    "A Letter": () => <DocumentPreview name="Caution Letter.pdf" mime="application/pdf" href={SAMPLE_PDF} height="page" />,
    "A Picture": () => <DocumentPreview name="Receipt.jpg" mime="image/jpeg" href={SAMPLE_IMAGE} sizeBytes={184320} height="sm" />,
    "Something Else": () => (
      <DocumentPreview name="Staff Import.xlsx" mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" href={SAMPLE_PDF} sizeBytes={920104} />
    ),
    "With Actions": () => (
      <DocumentPreview
        name="Receipt.pdf"
        mime="application/pdf"
        href={SAMPLE_PDF}
        sizeBytes={48213}
        height="sm"
        actions={<Button size="sm" icon="trash">Remove File</Button>}
      />
    ),
  },
} satisfies GalleryEntry;
