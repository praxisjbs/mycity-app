import type { ModuleScreenProps } from "@/shell/screens";
import { Analytics } from "./Analytics";
import { Contracts } from "./Contracts";
import { Leads } from "./Leads";
import { Partners } from "./Partners";
import { Pipeline } from "./Pipeline";
import { Proposals } from "./Proposals";
import { Categories } from "./Categories";

/**
 * Partnerships (docs/guides/partnerships.md §2, §10): routing only, one file a screen. Pipeline,
 * Partners and Leads with both 360s (M7 PR 3), Categories (PR 2) and Contracts & MOUs (PR 6) run on the
 * generated contract; Proposals and Analytics stay on the mock until their pull requests (Appendix A).
 */
export default function Partnerships({ tab, id }: ModuleScreenProps) {
  switch (tab) {
    case "partners":
      return <Partners id={id} />;
    case "leads":
      return <Leads id={id} />;
    case "proposals":
      return <Proposals />;
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
