import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { ShellNotice } from "./ShellNotice";

export default {
  component: "ShellNotice",
  states: {
    Update: () => (
      <ShellNotice
        icon="refresh"
        actions={
          <Button variant="primary" size="sm">
            Reload
          </Button>
        }
      >
        A new version is ready
      </ShellNotice>
    ),
    Install: () => (
      <ShellNotice
        icon="download"
        actions={
          <>
            <Button size="sm" variant="ghost">
              Not Now
            </Button>
            <Button size="sm" variant="primary">
              Install App
            </Button>
          </>
        }
      >
        Install MyCity App on this device
      </ShellNotice>
    ),
    Offline: () => <ShellNotice icon="offline">You are offline</ShellNotice>,
  },
} satisfies GalleryEntry;
