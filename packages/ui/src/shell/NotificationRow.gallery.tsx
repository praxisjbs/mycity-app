import type { GalleryEntry } from "../testing/gallery";
import { Button } from "../actions/Button";
import { NotificationRow } from "./NotificationRow";

export default {
  component: "NotificationRow",
  states: {
    Unread: () => (
      <NotificationRow
        title="Expense request waiting on you"
        body="Bashir Lawal · Lagos activation transport, ₦185,000.00"
        when="08:41"
        tone="warn"
        icon="check"
        unread
        action={<Button size="sm">Open</Button>}
      />
    ),
    Read: () => <NotificationRow title="Payroll preview ready" body="October run, 25 employees." when="12/10/2026" icon="wallet" />,
    List: () => (
      <div>
        <NotificationRow title="New application" body="Adaeze Okonkwo applied for Content Producer." when="07:20" icon="brief" unread />
        <NotificationRow title="You were recognised" body="Kept the Enugu shoot on schedule." when="Yesterday" tone="ok" icon="thumb" />
        <NotificationRow title="3 late arrivals in 30 days" when="Yesterday" tone="err" icon="clock" />
      </div>
    ),
  },
} satisfies GalleryEntry;
