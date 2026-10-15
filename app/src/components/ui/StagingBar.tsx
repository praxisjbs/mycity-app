import { useEnvironment } from "@/lib/environment";
import { Icon } from "@mycity/ui";

/**
 * The persistent staging bar (MILESTONES §6). On staging, above everything,
 * on every screen including sign-in: training and testing happen here, every
 * feature works and mail reaches real people, so nobody mistakes it for live.
 * Not dismissible. On production it renders nothing. On a notched phone it
 * takes the status-bar inset too, so its text is never under the notch.
 */
export function StagingBar() {
  if (useEnvironment() !== "staging") return null;
  return (
    <div role="status" className="pt-safe fixed inset-x-0 top-0 z-[100] flex h-(--env-bar) items-center justify-center gap-2 bg-warning px-3 text-[12px] font-semibold text-background">
      <Icon name="alert" className="size-[14px]" />
      <span>
        <b className="tracking-[.06em] uppercase">Staging</b>
        <span className="max-md:hidden"> · For training and testing. Every feature works and mail reaches real people.</span>
        <span className="md:hidden"> · Mail here is real</span>
      </span>
    </div>
  );
}
