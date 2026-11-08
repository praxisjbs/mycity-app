import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { Match, VerifyCard } from "./VerifyCard";

const rows = (content: "matches" | "differs", artifact: "matches" | "differs") => [
  { label: "Document", value: "Offer of employment" },
  { label: "Reference", value: "OFF-0016" },
  { label: "Signed By", value: "Obinna Chukwu" },
  { label: "Signed On", value: "21/10/2026, 14:05" },
  { label: "Issued By", value: "MyCity App Ltd" },
  { label: "Content Hash", value: <Match value={content} /> },
  { label: "Artifact Hash", value: <Match value={artifact} /> },
];

export default {
  component: "VerifyCard",
  states: {
    Waiting: () => <VerifyCard empty={{ title: "Enter a Reference", text: "The document's record shows here." }} />,
    Verified: () => <VerifyCard tone="ok" title="Document Verified" text="This document is genuine and unchanged." items={rows("matches", "matches")} />,
    Altered: () => <VerifyCard tone="warn" title="Not This Document" text="The stored file was altered." items={rows("matches", "differs")} />,
    "Not Found": () => <VerifyCard tone="err" title="Not Found" text="No document has this reference." items={[{ label: "Reference", value: "OFF-0099" }]} note="Check the reference on the document and try again. It looks like OFF-0018." />,
    "An Agreement By Its QR": () => (
      <VerifyCard
        tone="ok"
        title="Document Verified"
        text="This document is genuine and unchanged."
        items={rows("matches", "matches")}
        document={{
          heading: "The Document",
          title: "Deal Merchant Agreement",
          paragraphs: [],
          blocks: [
            { kind: "heading", level: 2, spans: [{ text: "Financials", bold: false, italic: false, href: null }] },
            {
              kind: "table",
              head: [[], [{ text: "Regular", bold: false, italic: false, href: null }], [{ text: "VIP", bold: false, italic: false, href: null }]],
              rows: [[[{ text: "Deal Price", bold: false, italic: false, href: null }], [{ text: "₦10,800.00", bold: false, italic: false, href: null }], [{ text: "₦27,000.00", bold: false, italic: false, href: null }]]],
            },
          ],
        }}
      />
    ),
    "By Its QR": () => (
      <VerifyCard
        tone="ok"
        title="Document Verified"
        text="This document is genuine and unchanged."
        items={rows("matches", "matches")}
        document={{
          heading: "The Document",
          title: "Offer of Employment",
          paragraphs: ["Dear Obinna, we are pleased to offer you the position of Content Producer at MyCity App Ltd, reporting to the Head of Content."],
          action: (
            <Button variant="line" size="sm" icon="download">
              Download PDF
            </Button>
          ),
        }}
      />
    ),
  },
} satisfies GalleryEntry;
