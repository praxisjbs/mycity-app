import type { GalleryEntry } from "../testing/gallery";
import { IssuedLetter } from "./IssuedLetter";

export default {
  component: "IssuedLetter",
  states: {
    "An Offer": () => (
      <IssuedLetter
        label="The offer letter"
        meta={["MyCity App Ltd", "Lagos, Nigeria", "06/11/2026"]}
        title="Offer of Employment"
        paragraphs={[
          "Dear Chiamaka,",
          "We are pleased to offer you the position of Content Producer at MyCity App Ltd, reporting to the Head of Content, with a start date of 20 October 2026.",
          "Your gross monthly salary will be ₦480,000, subject to a probationary period of three months.",
          "We look forward to working with you.",
        ]}
        from="Cynthia Osakunih, Operations and People Lead, for MyCity App Ltd"
      />
    ),
  },
} satisfies GalleryEntry;
