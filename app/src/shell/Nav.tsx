import { useApi } from "@/api/hooks";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { hrefFor, Link } from "@/lib/router";
import type { ModuleDef } from "./catalogue";

/** The rail's module list, grouped by area. Used by the desktop rail and the mobile drawer. */
export function NavList({ modules, current, slim, onNavigate }: { modules: ModuleDef[]; current: string | null; slim?: boolean; onNavigate?: () => void }) {
  const { data: badges } = useApi("GET /api/v1/notifications/badges");
  let lastArea: string | null = null;
  return (
    <nav className="scrollbar-on-dark flex flex-1 flex-col gap-px overflow-y-auto px-2.5 pt-0.5 pb-2.5" aria-label="Modules">
      {modules.map((m) => {
        const head = m.area !== lastArea && m.area ? m.area : null;
        lastArea = m.area;
        const on = m.key === current;
        const count = badges?.[m.key];
        return (
          <div key={m.key} className="contents">
            {head && (
              <div className={cn("px-2 pt-[14px] pb-[5px] text-[10px] font-[650] tracking-[.13em] whitespace-nowrap text-sidebar-muted uppercase transition-opacity", slim && "pointer-events-none opacity-0")}>
                {head}
              </div>
            )}
            <Link
              to={hrefFor(m.key)}
              onClick={onNavigate}
              aria-current={on ? "page" : undefined}
              title={slim ? m.label : undefined}
              className={cn(
                "flex items-center gap-[11px] rounded-ctl px-2.5 py-2 text-[13.5px] font-medium whitespace-nowrap no-underline transition-colors max-md:py-[11px] max-md:text-[14.5px]",
                on ? "bg-sidebar-primary font-[650] text-sidebar-primary-foreground" : "text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground",
              )}
            >
              <Icon name={m.icon} size="m" />
              <span data-ui="nav-label" className={cn("transition-opacity", slim && "pointer-events-none opacity-0")}>{m.label}</span>
              {count ? (
                <span className={cn("ml-auto rounded-full px-[7px] py-px text-[11px]", on ? "bg-on-primary-badge" : "bg-sidebar-badge", slim && "opacity-0")}>{count}</span>
              ) : null}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
