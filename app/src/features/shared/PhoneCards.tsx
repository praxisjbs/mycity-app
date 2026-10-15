import type { ReactNode } from "react";
import { IconCard, IconCards } from "@/components/ui/data";
import { type IconName } from "@mycity/ui";
import { MobileOnly } from "@/components/ui/layout";
import { useModal } from "@/components/ui/Modal";

/**
 * The phone layout of a long page (gate 11, ESS review 12 October): every
 * section becomes an icon card that opens it in the sheet, instead of a long
 * scroll of stacked cards. Rendered on a phone only; the desktop keeps its page.
 */
export function PhoneCards({ items }: { items: Array<{ icon: IconName; title: string; sub: string; body: ReactNode; wide?: boolean }> }) {
  const modal = useModal();
  return (
    <MobileOnly>
      <IconCards>
        {items.map((it) => (
          <IconCard key={it.title} icon={it.icon} title={it.title} text={it.sub} onClick={() => modal.open({ title: it.title, wide: it.wide, body: it.body })} />
        ))}
      </IconCards>
    </MobileOnly>
  );
}
