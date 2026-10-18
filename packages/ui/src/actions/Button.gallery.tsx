import type { GalleryEntry } from "../testing/gallery";
import { BigButton, Button, IconButton } from "./Button";

/** Two seconds of pretend work, so a press shows what a person sees while a request runs. */
const pretend = () => new Promise<void>((r) => setTimeout(r, 2000));

export default {
  component: "Button",
  states: {
    Primary: () => (
      <Button variant="primary" icon="plus">
        Create Rule
      </Button>
    ),
    Default: () => <Button icon="doc">Export</Button>,
    Ghost: () => (
      <Button variant="ghost" iconRight="right">
        View All
      </Button>
    ),
    Danger: () => <Button variant="danger">Delete Rule</Button>,
    Small: () => (
      <Button size="sm" icon="clock">
        Clock In
      </Button>
    ),
    Loading: () => (
      <Button variant="primary" busy>
        Save Changes
      </Button>
    ),
    "Loading With Icon": () => (
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon="send" busy>
          Send Note
        </Button>
        <Button icon="download" busy>
          Export
        </Button>
        <Button variant="ghost" iconRight="right" busy>
          View All
        </Button>
      </div>
    ),
    "Press To Try": () => (
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon="send" onClick={pretend}>
          Send Note
        </Button>
        <Button variant="danger" onClick={pretend}>
          Remove Device
        </Button>
        <IconButton icon="refresh" label="Refresh List" onClick={pretend} />
      </div>
    ),
    Disabled: () => <Button disabled>Approve Leave</Button>,
    Block: () => (
      <Button variant="primary" block>
        Send Application
      </Button>
    ),
    "As Link": () => (
      <Button asChild iconRight="right">
        <a href="#/Button">Open Payslips</a>
      </Button>
    ),
    "Icon Buttons": () => (
      <div className="flex items-center gap-2">
        <IconButton icon="srch" label="Search" />
        <IconButton icon="bell" label="Notifications" dot />
        <IconButton icon="dots" label="More Actions" size="sm" />
      </div>
    ),
    "Big Button": () => <BigButton icon="right">Sign In</BigButton>,
    "Big Button Loading": () => (
      <BigButton icon="right" busy>
        Sign In
      </BigButton>
    ),
  },
} satisfies GalleryEntry;
