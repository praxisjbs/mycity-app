/** The helpers every screen uses: classes, formats, the phone and installed-app queries, the window's history, press and hold, preferences, the typefaces and the saved appearance, the gate slots, control ids, the environment, the delivery plan, a mail body made ready for EmailFrame, the links in a message, the browser's captions while recording and the rows a list marks as new. */
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
export { fontStack, loadFont, FONT_IDS, type FontId } from "./fonts";
export { applyAppearance, appearanceCss, tokenDeclarations, APPEARANCE_STYLE_ID, type AppliedAppearance } from "./appearance";
export { SLOTS, content, slot, type Slot } from "./slots";
export { describedBy, useControlIds, type ControlIds } from "./ids";
export * from "./environment";
export * from "./plan";
export { uploadFile, type UploadOptions, type DocumentRef, type Uploader } from "./upload";
export { prepareEmail, referencedCids, splitQuoted, type PreparedEmail, type SplitEmail } from "./email-body";
export { findLinks, firstLink, normaliseLink, hostOf, LINK_ENDINGS, type FoundLink } from "./links";
export { captionsSupported, startCaptions, type Captions } from "./captions";
export { RowMarksContext, useRowMarks, type RowMarks } from "./marks";
