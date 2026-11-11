import type { ModuleScreenProps } from "@/shell/screens";
import { PoliciesTab } from "@/features/policies/PoliciesHub";
import { SopsTab } from "./Sops";
import { TrainingTab } from "./Training";
import { UserGuide } from "./UserGuide";

export default function Knowledge({ tab, id }: ModuleScreenProps) {
  switch (tab) {
    case "sops": return <SopsTab id={id} />;
    case "training": return <TrainingTab id={id} />;
    case "user-guide":
      return <UserGuide id={id} />;
    default: return <PoliciesTab />;
  }
}
