import type { ReactNode } from "react";

/**
 * The buttons at the foot of a form (§8.4): buttons only, never text. Desktop:
 * Cancel on the left, the primary on the right. Phone: the primary full width
 * at the bottom, the others above it. Put the primary last.
 */
export function FormFooter({ children }: { children: ReactNode }) {
  return (
    <div
      data-ui="modal-footer"
      className="-mx-[18px] mt-2 -mb-4 flex flex-wrap items-center justify-end gap-2 border-t border-border px-[18px] py-3 max-md:flex-col max-md:items-stretch max-md:[&>*]:w-full"
    >
      {children}
    </div>
  );
}
