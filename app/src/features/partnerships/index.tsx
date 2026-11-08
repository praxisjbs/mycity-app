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
 * Partners and Leads with both 360s run on the generated contract (M7 PR 3); Categories, Proposals,
 * Contracts & MOUs and Analytics stay on the mock until their pull requests (the guide's Appendix A).
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
      return <Contracts />;
    case "analytics":
      return <Analytics />;
    case "categories":
      return <Categories />;
    default:
      return <Pipeline id={id} />;
  }
}
