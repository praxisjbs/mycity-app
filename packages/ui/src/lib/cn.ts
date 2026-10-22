import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge taught the theme's own names (styles/theme.css), so it knows
 * `text-body` is a size and `text-muted-foreground` a colour, `h-control` a
 * height and `rounded-card` a radius, and lets the later class win.
 */
const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["2xs", "md", "body", "field"],
      spacing: ["control", "row", "tap"],
      radius: ["ctl", "box", "card", "sheet"],
      shadow: ["1", "2", "3"],
      "font-weight": ["strong"],
      animate: ["rise", "buzz", "pulse-dot", "slide-in", "shimmer"],
    },
  },
});

/** Join class names, skipping the falsy ones; of two that conflict, the later wins (`cn("h-control", "h-9")` is `h-9`). */
export function cn(...parts: ClassValue[]): string {
  return merge(clsx(parts));
}
