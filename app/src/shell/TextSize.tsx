import { useCallback } from "react";
import { SegmentedControl, TEXT_SIZES, toast, useModal, useTextSize, type TextSize as Size } from "@mycity/ui";

/**
 * Text Size (FRONTEND_FOUNDATION F30): Small, Default, Large or Largest for this person on this
 * device, applied the moment it is picked. The account menu, More and ⌘K open it.
 */
function TextSizeChoice() {
  const { size, setTextSize } = useTextSize();
  const pick = (next: Size) => {
    setTextSize(next);
    toast(`Text size: ${TEXT_SIZES.find(([v]) => v === next)?.[1] ?? "Default"}`);
  };
  return <SegmentedControl label="Text Size" value={size} onChange={pick} options={TEXT_SIZES.map(([v, name]) => [v, name] as [Size, string])} />;
}

/** Opens Text Size in the app's one modal (a bottom sheet on a phone). */
export function useTextSizeSheet(): () => void {
  const modal = useModal();
  return useCallback(() => modal.open({ title: "Text Size", body: () => <TextSizeChoice /> }), [modal]);
}
