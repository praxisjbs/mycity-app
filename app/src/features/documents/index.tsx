import type { ModuleScreenProps } from "@/shell/screens";
import { Categories } from "./Categories";
import { Library } from "./Library";

/**
 * Document Centre (docs/guides/document-centre.md §2, §10): routing only, one file a screen. Library
 * is everyone's; Categories is for those who keep the library (`documents.manage`, the shell's tabs).
 */
export default function DocumentCentre({ tab, id }: ModuleScreenProps) {
  return tab === "categories" ? <Categories id={id} /> : <Library id={id} />;
}
