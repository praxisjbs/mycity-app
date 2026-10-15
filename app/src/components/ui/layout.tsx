import type { HTMLAttributes } from "react";
import { cn } from "@mycity/ui";

/** Secondary text: 11.5 px, the faintest ink. */
export function Sub({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("text-[11.5px] text-subtle-foreground", className)} {...rest} />;
}
