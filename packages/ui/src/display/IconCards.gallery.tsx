import type { GalleryEntry } from "../testing/gallery";
import { IconCard, IconCards } from "./IconCards";

const noop = () => {};

export default {
  component: "IconCards",
  states: {
    "Two Columns": () => (
      <IconCards>
        <IconCard icon="shield" title="Password" text="Changed 02/10/2026" onClick={noop} />
        <IconCard icon="lock" title="Two-Step Sign-In" text="On" onClick={noop} />
        <IconCard icon="user" title="Passkeys" text="1 registered" onClick={noop} />
        <IconCard icon="clock" title="Devices" text="2 active" count={1} onClick={noop} />
      </IconCards>
    ),
    "Three Columns": () => (
      <IconCards cols={3}>
        <IconCard icon="wallet" title="Payslips" text="October paid" onClick={noop} />
        <IconCard icon="doc" title="Documents" text="4 signed" onClick={noop} />
        <IconCard icon="check" title="Leave" text="18 days left" onClick={noop} />
      </IconCards>
    ),
  },
} satisfies GalleryEntry;
