import type { GalleryEntry } from "../testing/gallery";
import { Pill } from "../display/Pill";
import { Icon } from "../icons/Icon";
import { OrderList, type OrderListItem } from "./OrderList";

const row = (icon: "doc" | "video" | "link" | "book", title: string, kind: string, minutes: number) => (
  <span className="flex items-center gap-2.5">
    <Icon name={icon} size="s" className="flex-none text-subtle-foreground" />
    <span className="flex min-w-0 flex-col">
      <b data-copy="content" className="text-sm font-semibold wrap-any">{title}</b>
      <span className="text-2xs text-subtle-foreground">{`${kind}, ${minutes} minutes`}</span>
    </span>
  </span>
);

const ITEMS: OrderListItem[] = [
  { key: "a", name: "Staff Handbook", content: row("doc", "Staff Handbook", "File", 20), menu: [{ label: "Edit Item", icon: "edit", onSelect: () => undefined }, { label: "Remove Item", icon: "trash", danger: true, onSelect: () => undefined }] },
  { key: "b", name: "Why Data Matters", content: row("video", "Why Data Matters", "Video Link", 6), menu: [{ label: "Edit Item", icon: "edit", onSelect: () => undefined }] },
  { key: "c", name: "NDPA in Practice", content: row("link", "NDPA in Practice", "Course Link", 45), menu: [{ label: "Edit Item", icon: "edit", onSelect: () => undefined }] },
  { key: "d", name: "Key Rules", content: row("book", "Key Rules", "Lesson", 10), menu: [{ label: "Edit Item", icon: "edit", onSelect: () => undefined }] },
];

export default {
  component: "OrderList",
  states: {
    Default: () => <OrderList label="Course Items" items={ITEMS} onMove={() => new Promise((r) => setTimeout(r, 600))} />,
    "Fixed Order": () => <OrderList label="Course Items" items={ITEMS.map(({ menu: _menu, ...i }) => i)} />,
    "With Pills": () => (
      <OrderList
        label="Course Items"
        items={ITEMS.slice(0, 2).map((i) => ({ ...i, content: <span className="flex items-center justify-between gap-2">{i.content}<Pill tone="ok">Done</Pill></span> }))}
        onMove={() => undefined}
      />
    ),
  },
} satisfies GalleryEntry;
