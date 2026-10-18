import type { GalleryEntry } from "../testing/gallery";
import { Button } from "./Button";
import { ActionGroup } from "./ActionGroup";

/** Two seconds of pretend work, so the gallery shows the press as a person sees it. */
const pretend = () => new Promise<void>((r) => setTimeout(r, 2000));

export default {
  component: "ActionGroup",
  states: {
    Default: () => (
      <div className="flex flex-wrap items-center gap-2">
        <ActionGroup>
          <Button variant="danger" onClick={pretend}>
            Reject Leave
          </Button>
          <Button variant="primary" icon="ok" onClick={pretend}>
            Approve Leave
          </Button>
        </ActionGroup>
      </div>
    ),
    Waiting: () => (
      <div className="flex flex-wrap items-center gap-2">
        <ActionGroup>
          <Button variant="danger">Reject Leave</Button>
          <Button variant="primary" icon="ok" busy>
            Approve Leave
          </Button>
        </ActionGroup>
      </div>
    ),
  },
} satisfies GalleryEntry;
