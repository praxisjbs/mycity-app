import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { Field } from "./Field";
import { UploadField } from "./UploadField";
import { slowUploader } from "./fixtures";

export default {
  component: "UploadField",
  states: {
    Default: () => <UploadField purpose="receipt" upload={slowUploader} />,
    "One File": () => <UploadField purpose="cv" upload={slowUploader} multiple={false} accept=".pdf,.doc,.docx" kinds="PDF or Word" maxBytes={5 * 1024 * 1024} label="Choose your CV" />,
    Compact: () => <UploadField purpose="receipt" upload={slowUploader} compact />,
    "Own Control": () => <UploadField purpose="attachment" upload={slowUploader} trigger={(open) => <Button icon="clip" onClick={open}>Attach File</Button>} />,
    "In A Field": () => (
      <Field label="Receipts" optional>
        <UploadField purpose="receipt" upload={slowUploader} compact />
      </Field>
    ),
  },
} satisfies GalleryEntry;
