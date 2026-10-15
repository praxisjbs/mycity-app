import type { GalleryEntry } from "../testing/gallery";
import { BigButton, Button, IconButton } from "./Button";

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
  },
} satisfies GalleryEntry;
