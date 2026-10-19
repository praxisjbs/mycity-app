import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { NotificationBanner, notify } from "./NotificationBanner";

export default {
  component: "NotificationBanner",
  states: {
    Mail: () => (
      <NotificationBanner title="Tom-Blake Asaah" body={"Re: Test mail\nThe signed copy is attached."} avatar="Tom-Blake Asaah" onOpen={() => undefined} onDismiss={() => undefined} />
    ),
    Approval: () => <NotificationBanner title="Approval needed: Leave request" body="Line manager is waiting on you." icon="check" tone="warn" onDismiss={() => undefined} />,
    "Show One": () => (
      <Button
        variant="primary"
        onClick={() => notify({ id: `gallery-${Date.now()}`, title: "Ada Okafor", body: "Lunch is here!", avatar: "Ada Okafor" })}
      >
        Show Banner
      </Button>
    ),
  },
} satisfies GalleryEntry;
