import { ICON_PATHS, type IconName } from "./icon-paths";
import { cn } from "@/lib/cn";

/** Renders the whole icon set once, hidden, at the top of the app. */
export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        {Object.entries(ICON_PATHS).map(([name, body]) => (
          <g key={name} id={`i-${name}`} dangerouslySetInnerHTML={{ __html: body }} />
        ))}
      </defs>
    </svg>
  );
}

/**
 * One glyph from the set. `size="m"` is the 20 px navigation icon, the default
 * `s` is the 16 px inline icon. Decorative unless given a `label`.
 */
export function Icon({ name, size = "s", className, label }: { name: IconName; size?: "s" | "m"; className?: string; label?: string }) {
  return (
    <svg
      className={cn("flex-none", size === "m" ? "size-5 [stroke-width:1.6]" : "size-4 [stroke-width:1.7]", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      <use href={`#i-${name}`} />
    </svg>
  );
}

export type { IconName };
