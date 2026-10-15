import { useEffect, type ReactNode } from "react";
import { DEMO_LINKS } from "@/api/mock/demo-links";
import { cn, Icon, useTheme } from "@mycity/ui";
import { Link } from "@/lib/router";

/** The MyCityApp mark: the pin and the name, in the brand green (the demo's public pages). */
export function Brand({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span className="inline-flex items-center gap-[9px] text-accent-foreground">
      <Icon name="pin" />
      <b className={size === "lg" ? "text-[16px]" : "text-[15px]"}>MyCityApp</b>
    </span>
  );
}

/**
 * Every public page: a top row (the mark where the page has none of its own,
 * and the theme toggle), the page itself on a card at most 660 px wide, and a
 * footer. `index` decides whether search engines may list the page: only the
 * careers list and a vacancy may (MILESTONES §6); every token page says noindex.
 */
export function Page({ title, index = false, brandInCard = false, children, below }: { title: string; index?: boolean; brandInCard?: boolean; children: ReactNode; below?: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · MyCity App`;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "robots";
      document.head.appendChild(meta);
    }
    meta.content = index ? "index, follow" : "noindex, nofollow";
  }, [title, index]);
  const { theme, toggle } = useTheme();
  return (
    <div className="flex min-h-[calc(100dvh-var(--env-bar))] flex-col">
      <header className="mx-auto flex w-full max-w-[704px] items-center justify-between px-[22px] pt-5 pb-3 max-md:px-4">
        {brandInCard ? <span /> : <Link to="/jobs" className="no-underline" aria-label="MyCityApp careers"><Brand /></Link>}
        <button
          type="button"
          onClick={toggle}
          aria-label={theme === "dark" ? "Use light mode" : "Use dark mode"}
          title={theme === "dark" ? "Light mode" : "Dark mode"}
          className="flex size-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>
      </header>
      <main className="mx-auto w-full max-w-[704px] flex-1 px-[22px] pb-6 max-md:px-0">
        <div className="animate-rise rounded-[12px] border border-border bg-background p-[22px] max-md:rounded-none max-md:border-x-0 max-md:p-[18px]">{children}</div>
        {below}
      </main>
      <footer className="mx-auto w-full max-w-[704px] px-[22px] pb-6 text-[11.5px] text-subtle-foreground max-md:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3.5">
          <span>MyCity App Ltd · Lagos, Nigeria</span>
          <span className="flex gap-3.5">
            <Link to="/jobs" className="hover:text-foreground">Careers</Link>
            <Link to="/verify" className="hover:text-foreground">Verify a Document</Link>
          </span>
        </div>
        {import.meta.env.VITE_API_MODE === "mock" && <DemoStrip />}
      </footer>
    </div>
  );
}

/** Mock mode only: the sample addresses, so every state can be opened without an email. */
function DemoStrip() {
  return (
    <details className="mt-3 rounded-box border border-dashed border-border px-3 py-2">
      <summary className="cursor-pointer text-[11.5px] font-semibold">Demo links</summary>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {DEMO_LINKS.map(([label, to]) => (
          <Link key={to} to={to} className={cn("rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground no-underline hover:text-foreground")}>
            {label}
          </Link>
        ))}
      </div>
    </details>
  );
}

/** A whole-page message: a bad link, an expired one, a role that is not there. */
export function Message({ icon = "alert", tone = "neutral", title, children, action }: { icon?: Parameters<typeof Icon>[0]["name"]; tone?: "neutral" | "ok" | "warn" | "err"; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="py-6 text-center">
      <span
        className={cn(
          "mx-auto flex size-[58px] items-center justify-center rounded-full",
          tone === "ok" && "bg-success-soft text-success",
          tone === "warn" && "bg-warning-soft text-warning",
          tone === "err" && "bg-destructive-soft text-destructive",
          tone === "neutral" && "bg-accent text-accent-foreground",
        )}
      >
        <Icon name={icon} className="size-7" />
      </span>
      <h2 className="mt-3 text-[19px]">{title}</h2>
      {children && <div className="mx-auto mt-2 max-w-[46ch] text-[13px] text-muted-foreground">{children}</div>}
      {action && <div className="mt-5 flex justify-center gap-2">{action}</div>}
    </div>
  );
}
