/**
 * The Overlays group. Each component file in this folder is exported here (npm run new:component adds the line).
 */
export { Modal, ModalProvider, ModalFooter, Grow, useModal, type ModalProps, type ModalProviderProps, type ModalFooterProps, type GrowProps, type ModalSpec, type ModalApi, type ModalContent } from "./Modal";
export { Sheet, type SheetProps } from "./Sheet";
export { SidePanel, type SidePanelProps } from "./SidePanel";
export { ConfirmDialog, useConfirm, type ConfirmDialogProps, type ConfirmOptions } from "./ConfirmDialog";
export { Popover, type PopoverProps } from "./Popover";
export { Menu, type MenuProps, type MenuItem, type MenuTriggerProps } from "./Menu";
export { Tooltip, type TooltipProps } from "./Tooltip";
export { useUnsavedChanges, useDismiss } from "./context";
