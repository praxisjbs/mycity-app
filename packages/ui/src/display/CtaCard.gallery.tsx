import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { CtaCard, CtaCards } from "./CtaCard";

export default {
  component: "CtaCard",
  states: {
    "Two Calls": () => (
      <CtaCards>
        <CtaCard
          tone="deep"
          from="left"
          icon="userplus"
          title="Know Someone Great?"
          text="Send them our roles. Their application comes straight to our hiring team."
          action={
            <Button variant="primary" size="lg">
              Copy Careers Link
            </Button>
          }
        />
        <CtaCard
          from="right"
          delay={120}
          icon="shieldok"
          title="Verify a Document"
          text="Check an offer letter or certificate MyCityApp issued, by its reference."
          action={
            <Button variant="line" size="lg">
              Verify a Document
            </Button>
          }
        />
      </CtaCards>
    ),
  },
} satisfies GalleryEntry;
