import type { GalleryEntry } from "../testing/gallery";
import { RichText, type RichTextBlock } from "./RichText";

const span = (text: string, marks: Partial<{ bold: boolean; italic: boolean; href: string | null }> = {}) => ({
  text,
  bold: false,
  italic: false,
  href: null,
  ...marks,
});

const POLICY: RichTextBlock[] = [
  { kind: "heading", level: 2, spans: [span("Company Equipment")] },
  { kind: "paragraph", spans: [span("Laptops and phones issued by MyCity remain "), span("company property", { bold: true }), span(" at all times.")] },
  { kind: "heading", level: 3, spans: [span("When You Leave")] },
  { kind: "numbered", items: [[span("Return your laptop and charger on your last day.")], [span("Return your access card to the front desk.")]] },
  { kind: "heading", level: 3, spans: [span("Questions")] },
  { kind: "bullets", items: [[span("Write to "), span("people@mycityapp.io", { href: "mailto:people@mycityapp.io" })], [span("Or ask your line manager.", { italic: true })]] },
];

export default {
  component: "RichText",
  states: {
    Policy: () => <RichText blocks={POLICY} />,
    "Under A Card Title": () => <RichText blocks={POLICY} top={3} />,
    "One Paragraph": () => <RichText blocks={POLICY.filter((b) => b.kind === "paragraph")} />,
  },
} satisfies GalleryEntry;
