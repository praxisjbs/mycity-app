/** The helpers every screen uses: classes, formats, the phone query, preferences, the gate slots, control ids, the environment, the delivery plan, a mail body made ready for EmailFrame and the links in a message. */
export { cn } from "./cn";
export * from "./format";
export { PHONE_QUERY, useIsMobile, useIsPhone, useMediaQuery } from "./media";
export * from "./preferences";
export { SLOTS, content, slot, type Slot } from "./slots";
export { describedBy, useControlIds, type ControlIds } from "./ids";
export * from "./environment";
export * from "./plan";
export { uploadFile, type UploadOptions, type DocumentRef, type Uploader } from "./upload";
export { prepareEmail, referencedCids, splitQuoted, type PreparedEmail, type SplitEmail } from "./email-body";
export { findLinks, firstLink, normaliseLink, hostOf, LINK_ENDINGS, type FoundLink } from "./links";
