import type { ModuleScreenProps } from "@/shell/screens";
import { Analytics } from "./Analytics";
import { Contracts } from "./Contracts";
import { Leads } from "./Leads";
import { Partner360 } from "./Partner360";
import { Partners } from "./Partners";
import { Pipeline } from "./Pipeline";
import { Proposals } from "./Proposals";
import { Categories } from "./Categories";

/**
 * Partnerships (docs/guides/partnerships.md §2, §10): routing only, one file a screen. The screens run
 * on the in-browser mock until each one's M7 pull request builds it on the real API (the guide's
 * Appendix A); until then the shell shows Coming Soon outside the mock.
 */
export default function Partnerships({ tab, id }: ModuleScreenProps) {
  if (id && (tab === "partners" || tab === "pipeline")) return <Partner360 id={id} back={tab} />;
  switch (tab) {
    case "partners":
      return <Partners />;
    case "leads":
      return <Leads />;
    case "proposals":
      return <Proposals />;
    case "contracts-and-mous":
      return <Contracts />;
    case "analytics":
      return <Analytics />;
    case "categories":
      return <Categories />;
    default:
      return <Pipeline />;
  }
}
