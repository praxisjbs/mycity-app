import type { ModuleScreenProps } from "@/shell/screens";
import { Library } from "./Library";

/**
 * Document Centre (docs/guides/document-centre.md §2, §10): routing only, one file a screen. The
 * Library runs on the generated contract; Categories joins it with the guide's PR 2.
 */
export default function DocumentCentre({ id }: ModuleScreenProps) {
  return <Library id={id} />;
}
