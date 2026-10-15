import type { ReactNode } from "react";
import { cn } from "@mycity/ui";

/** The small grey line under a heading. Moves into packages/ui in PR 3 (display). */
export const Sub = ({ children, className }: { children: ReactNode; className?: string }) => <p className={cn("text-[12.5px] text-subtle-foreground", className)}>{children}</p>;
