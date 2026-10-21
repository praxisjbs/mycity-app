/** The helpers every screen uses: classes, formats, the phone and installed-app queries, the window's history, press and hold, preferences, the gate slots, control ids, the environment, the delivery plan, a mail body made ready for EmailFrame, the links in a message and the browser's captions while recording. */
export { cn } from "./cn";
export * from "./format";
export { INSTALLED_QUERY, PHONE_QUERY, isInstalled, useInstalled, useIsMobile, useIsPhone, useMediaQuery } from "./media";
export {
  currentStep,
  goHistory,
  historyStartedFresh,
  onHistory,
  pushStep,
  replaceStep,
  resetHistoryForTest,
  restoreSteps,
  startHistory,
  useBackClose,
  type HistoryChange,
} from "./history";
export { useHold, type HoldHandlers, type HoldOptions } from "./hold";
export * from "./preferences";
export { SLOTS, content, slot, type Slot } from "./slots";
export { describedBy, useControlIds, type ControlIds } from "./ids";
export * from "./environment";
export * from "./plan";
export { uploadFile, type UploadOptions, type DocumentRef, type Uploader } from "./upload";
export { prepareEmail, referencedCids, splitQuoted, type PreparedEmail, type SplitEmail } from "./email-body";
export { findLinks, firstLink, normaliseLink, hostOf, LINK_ENDINGS, type FoundLink } from "./links";
export { captionsSupported, startCaptions, type Captions } from "./captions";
