import type { ReactNode } from "react";
import { cn } from "@mycity/ui";

/** Article list on the left, the article on the right (Knowledge Hub). A scrolling strip above it on smaller screens. */
export function Reader({ groups, selected, onSelect, children }: { groups: Array<{ label: string; items: Array<{ key: string; title: string }> }>; selected: string | null; onSelect: (key: string) => void; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[250px_1fr]">
      <nav data-copy="content" className="flex gap-1.5 overflow-x-auto rounded-card border border-border bg-card p-[7px] shadow-1 xl:block xl:p-2" aria-label="Articles">
        {groups.map((g) => (
          <div key={g.label} className="contents xl:block">
            <div className="hidden px-[11px] pt-2.5 pb-1 text-[10px] font-[650] tracking-[.11em] text-subtle-foreground uppercase xl:block">{g.label}</div>
            {g.items.map((it) => (
              <button
                key={it.key}
                type="button"
                onClick={() => onSelect(it.key)}
                className={cn(
                  "block flex-none rounded-ctl px-[11px] py-[9px] text-left text-[12.5px] font-[550] whitespace-nowrap xl:w-full xl:whitespace-normal max-md:min-h-11",
                  selected === it.key ? "bg-accent font-[650] text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {it.title}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <article className="min-w-0 rounded-card border border-border bg-card px-[26px] py-[22px] shadow-1 max-md:p-4">{children}</article>
    </div>
  );
}

/** An article's own typography. */
export function ArticleBody({ title, meta, children }: { title: ReactNode; meta?: ReactNode; children: ReactNode }) {
  return (
    <div data-copy="content">
      <h2 className="text-[20px] tracking-[-.022em]">{title}</h2>
      {meta && <div className="my-2.5 mb-[18px] flex flex-wrap gap-2 border-b border-border pb-4">{meta}</div>}
      <div className="text-[13px] leading-[1.68] text-muted-foreground [&_blockquote]:mt-[14px] [&_blockquote]:rounded-r-[9px] [&_blockquote]:border-l-[3px] [&_blockquote]:border-primary [&_blockquote]:bg-muted [&_blockquote]:px-[15px] [&_blockquote]:py-[11px] [&_blockquote]:text-[12.5px] [&_h4]:mt-5 [&_h4]:text-[13.5px] [&_h4]:text-foreground [&_li]:mb-[5px] [&_p]:mt-2 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
    </div>
  );
}
