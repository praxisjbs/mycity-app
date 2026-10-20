import type { ModuleScreenProps } from "@/shell/screens";
import { Actions } from "./Actions";
import { Models } from "./Models";
import { Spend } from "./Spend";

/**
 * AI Control (docs/guides/ai-control.md): which model answers each AI feature, the models'
 * prices, and what AI costs each month. Held by `ai_control`: IT edits, Operations & People view.
 */
export default function AiControl({ tab }: ModuleScreenProps) {
  switch (tab) {
    case "models":
      return <Models />;
    case "spend":
      return <Spend />;
    default:
      return <Actions />;
  }
}
