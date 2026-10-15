import { useEnvironment } from "@/lib/environment";
import { Icon } from "./Icon";

/**
 * The persistent staging bar (MILESTONES §6), the public site's copy: it sticks
 * to the top while the page scrolls. On production it renders nothing.
 */
export function StagingBar() {
  if (useEnvironment() !== "staging") return null;
  return (
    <div role="status" className="sticky top-0 z-[100] flex h-(--env-bar) items-center justify-center gap-2 bg-warning px-3 text-[12px] font-semibold text-background">
      <Icon name="alert" className="size-[14px]" />
      <span>
        <b className="tracking-[.06em] uppercase">Staging</b>
        <span className="max-md:hidden"> · A test copy of the MyCity App site. Applications and signatures here are not for real roles.</span>
        <span className="md:hidden"> · A test copy of this site</span>
      </span>
    </div>
  );
}
