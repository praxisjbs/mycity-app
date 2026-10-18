import { EmptyState, PageHeader } from "@mycity/ui";

/**
 * A Home tab the reader's capabilities do not open (docs/guides/home.md §10.1, §11): the
 * tab's title and the lock, in place of an empty screen or an error, so the four tabs stay
 * where they are. It reads nothing, since the tab's own reads would only be refused.
 */
export function Gated({ title }: { title: "Team" | "Alerts" | "Reports" }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState illustration="Locked" title="For Managers" text="This tab is for managers and the CEO." />
    </>
  );
}
