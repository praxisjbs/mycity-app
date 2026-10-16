/**
 * @component Reader
 * @group Documents
 * @summary An article list beside the article: the Knowledge Hub's shape, and anything else read one piece at a time.
 * @use The Knowledge Hub's articles and FAQs, a policy library, a set of runbooks a person reads one of.
 * @avoid A list of records (use DataView); a set of short answers (use Accordion); a single article with nothing to pick from.
 * @phone The list becomes a scrolling strip of chips above the article, so the article itself has the whole width.
 * @a11y The list is a navigation landmark whose current article says it is current, and the article is an <article> with its own heading.
 * @status stable
 * @exports ArticleBody
 * @example <Reader groups={groups} selected={key} onSelect={setKey}><ArticleBody title={article.title}>{article.body}</ArticleBody></Reader>
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { content } from "../lib/slots";

/** One heading in the list, and the articles under it. */
export interface ReaderGroup {
  /** The group's name, Title Case, at most 3 words. */
  label: string;
  /** Its articles, in the order they should be read. */
  items: Array<{ key: string; title: string }>;
}

export interface ReaderProps {
  /** The list, grouped. */
  groups: ReaderGroup[];
  /** The article in view. */
  selected: string | null;
  /** Called with the article chosen. */
  onSelect: (key: string) => void;
  /** Names the list for screen readers; "Articles" unless set. */
  label?: string;
  /** The article itself. */
  children: ReactNode;
  /** Layout classes only (spacing). */
  className?: string;
}

export function Reader({ groups, selected, onSelect, label = "Articles", children, className }: ReaderProps) {
  return (
    <div className={cn("reader-columns grid grid-cols-1 items-start gap-3", className)}>
      <nav {...content} aria-label={label} className="no-scrollbar flex gap-1.5 overflow-x-auto rounded-card border border-border bg-card p-1.5 shadow-1 xl:block xl:p-2">
        {groups.map((group) => (
          <div key={group.label} className="contents xl:block">
            <div className="hidden px-3 pt-2.5 pb-1 text-2xs font-strong tracking-caps text-subtle-foreground uppercase xl:block">{group.label}</div>
            {group.items.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-current={selected === item.key ? "page" : undefined}
                onClick={() => onSelect(item.key)}
                className={cn(
                  "block flex-none rounded-ctl px-3 py-2 text-left text-xs font-semibold whitespace-nowrap phone:min-h-tap xl:w-full xl:whitespace-normal",
                  selected === item.key ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {item.title}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <article className="min-w-0 rounded-card border border-border bg-card px-6 py-5 shadow-1 phone:p-4">{children}</article>
    </div>
  );
}

export interface ArticleBodyProps {
  /** The article's own title. */
  title: ReactNode;
  /** What sits under it: the author, the date, a pill. */
  meta?: ReactNode;
  /** The article. */
  children: ReactNode;
}

/** An article's own typography, inside a Reader or on its own page. */
export function ArticleBody({ title, meta, children }: ArticleBodyProps) {
  return (
    <div {...content}>
      <h2 className="text-2xl">{title}</h2>
      {meta != null && <div className="mt-2.5 mb-4 flex flex-wrap gap-2 border-b border-border pb-4">{meta}</div>}
      <div className="rte text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
  );
}
