import type { CourseState, EnrolmentStatus, ItemKind, TrainingItem } from "@mycity/contract/contract.gen.ts";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@mycity/ui";

/**
 * What Knowledge Hub · Training and ESS · My Training say about a course, a person's place on it
 * and an item (docs/guides/knowledge.md §10.1): the state and status pills, an item's kind, glyph
 * and minutes, and an item's line in a list.
 */

export const STATE_PILL: Record<CourseState, { tone: "ok" | "info" | "neutral"; text: string }> = {
  draft: { tone: "info", text: "Draft" },
  published: { tone: "ok", text: "Published" },
  archived: { tone: "neutral", text: "Archived" },
};
export const STATUS_PILL: Record<EnrolmentStatus, { tone: "ok" | "info" | "warn" | "neutral"; text: string }> = {
  not_started: { tone: "neutral", text: "Not Started" },
  in_progress: { tone: "info", text: "In Progress" },
  completed: { tone: "ok", text: "Completed" },
  overdue: { tone: "warn", text: "Overdue" },
};
export const KIND_LABEL: Record<ItemKind, string> = { file: "File", video: "Video Link", link: "Course Link", lesson: "Lesson" };
/** An item's glyph: a file by what it holds. */
export const kindIcon = (i: Pick<TrainingItem, "kind" | "document_type">): IconName =>
  i.kind === "lesson" ? "book" : i.kind === "link" ? "external" : i.kind === "video" || i.document_type?.startsWith("video/") ? "video" : i.document_type?.startsWith("image/") ? "image" : "doc";
export const minutesText = (n: number | null) => (n === null ? null : `${n} minute${n === 1 ? "" : "s"}`);

/** An item in a list: its glyph, its title, its kind and minutes. */
export function ItemLine({ it, end }: { it: Pick<TrainingItem, "kind" | "title" | "minutes" | "document_type">; end?: ReactNode }) {
  return (
    <span className="flex items-center gap-2.5">
      <Icon name={kindIcon(it)} size="s" className="flex-none text-subtle-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span data-copy="content" className="text-sm font-semibold wrap-any">
          {it.title}
        </span>
        <span className="text-2xs text-subtle-foreground">{[KIND_LABEL[it.kind], minutesText(it.minutes)].filter(Boolean).join(", ")}</span>
      </span>
      {end}
    </span>
  );
}
