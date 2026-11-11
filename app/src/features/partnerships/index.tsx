import type { ModuleScreenProps } from "@/shell/screens";
import { Analytics } from "./Analytics";
import { Contracts } from "./Contracts";
import { Leads } from "./Leads";
import { Partners } from "./Partners";
import { Pipeline } from "./Pipeline";
import { Proposals } from "./Proposals";
import { Categories } from "./Categories";

/**
 * Partnerships (docs/guides/partnerships.md §2, §10): routing only, one file a screen. Every tab runs on
 * the generated contract: Categories (M7 PR 2), Pipeline, Partners and Leads with both 360s (PR 3),
 * Contracts & MOUs (PR 6), Proposals (PR 7) and Analytics (PR 8).
 */
export default function Partnerships({ tab, id }: ModuleScreenProps) {
  switch (tab) {
    case "partners":
      return <Partners id={id} />;
    case "leads":
      return <Leads id={id} />;
    case "proposals":
      return <Proposals id={id} />;
    case "contracts-and-mous":
      return <Contracts id={id} />;
    case "analytics":
      return <Analytics />;
    case "categories":
      return <Categories />;
    default:
      return <Pipeline id={id} />;
  }
}
