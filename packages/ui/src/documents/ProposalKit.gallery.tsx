import type { GalleryEntry } from "../testing/gallery";
import { DocumentFrame } from "./DocumentFrame";
// Every layout of the proposal design kit, drawn by the kit itself from templates/proposals/sample.json
// (scripts/gen/proposal-kit.js writes it; a test holds it current). Invented content throughout.
import sample from "./proposal-kit.sample.html?raw";

/** The proposal design kit (docs/guides/partnerships.md §6.11): its thirteen layouts at 16:9, as the PDF, the studio and the public page show them. */
export default {
  component: "ProposalKit",
  states: {
    "Every Layout": () => <DocumentFrame title="Proposal design kit" html={sample} />,
  },
} satisfies GalleryEntry;
