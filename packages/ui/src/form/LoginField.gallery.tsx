import type { GalleryEntry } from "../testing/gallery";
import { LoginField } from "./LoginField";

const noop = () => undefined;

export default {
  component: "LoginField",
  states: {
    Empty: () => <LoginField id="g-email" label="Work Email" type="email" autoComplete="username" value="" onChange={noop} onBlur={noop} error="" good={false} buzz={0} />,
    Right: () => <LoginField id="g-email-ok" label="Work Email" type="email" autoComplete="username" value="ada@mycity.app" onChange={noop} onBlur={noop} error="" good buzz={0} />,
    Error: () => <LoginField id="g-pass" label="Password" type="password" autoComplete="current-password" value="secret" onChange={noop} onBlur={noop} error="Wrong password" good={false} buzz={0} />,
  },
} satisfies GalleryEntry;
