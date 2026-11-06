import type { GalleryEntry } from "../testing/gallery";
import { RichText } from "../documents/RichText";
import type { RichTextBlock } from "../documents/RichText";
import { IconList } from "./IconList";
import { RolePart } from "./RolePart";

const span = (text: string) => ({ text, bold: false, italic: false, href: null });
const OVERVIEW: RichTextBlock[] = [
  { kind: "paragraph", spans: [span("The Head, Sales & Revenue will lead MyCityApp and MyLagosApp's commercial growth by developing and executing the sales and revenue strategy.")] },
  { kind: "heading", level: 2, spans: [span("1. Sales & Revenue Strategy")] },
  { kind: "bullets", items: [[span("Identify new revenue opportunities, products and commercial models.")], [span("Set clear sales targets and revenue objectives.")]] },
];

export default {
  component: "RolePart",
  states: {
    "Two Parts": () => (
      <div>
        <RolePart title="Role Overview">
          <RichText look="site" blocks={OVERVIEW} top={3} />
        </RolePart>
        <RolePart title="Key Performance Indicators (KPIs)" record>
          <IconList icon="trend" label="Key Performance Indicators (KPIs)" items={["Revenue against target", "New clients and merchants", "Value of closed deals", "Sales pipeline value"]} />
        </RolePart>
      </div>
    ),
  },
} satisfies GalleryEntry;
