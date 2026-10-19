import type { GalleryEntry } from "../testing/gallery";
import { NotificationRow } from "./NotificationRow";

const nothing = () => undefined;

export default {
  component: "NotificationRow",
  states: {
    "Unread Mail": () => (
      <NotificationRow title="Tom-Blake Asaah" body={"Re: Confirm attachments work\nThe signed copy is attached, please check the second page."} when="05:33" avatar="Tom-Blake Asaah" unread onOpen={nothing} onMarkRead={nothing} />
    ),
    "Read Approval": () => <NotificationRow title="Approval needed: Leave request" body="Line manager is waiting on you." when="Yesterday" icon="check" tone="warn" onOpen={nothing} />,
    List: () => (
      <ul className="divide-y divide-border">
        <li>
          <NotificationRow title="#general · 4 new posts" body="Ada Okafor: Lunch is here!" when="12:02" avatar="#general" unread onOpen={nothing} onMarkRead={nothing} />
        </li>
        <li>
          <NotificationRow title="New sign-in to your account" body="Edge on Windows, 105.127.11.59. If this was not you, reset your password now." when="Yesterday" icon="lock" tone="warn" onOpen={nothing} />
        </li>
        <li>
          <NotificationRow title="You were recognised" body="Kept the Enugu shoot on schedule." when="16/10/2026" icon="thumb" tone="ok" onOpen={nothing} />
        </li>
      </ul>
    ),
  },
} satisfies GalleryEntry;
