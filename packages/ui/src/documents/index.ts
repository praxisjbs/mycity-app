/**
 * The Documents group: what the product generated (Paper, which prints), what
 * someone uploaded (DocumentPreview and ImageViewer, drawn by the browser
 * itself) and what someone wrote (Reader).
 *
 * PR 3 question 4: a PDF streams into an `<object>` and anything that refuses
 * it inline becomes a Download card; a picture goes to the image viewer; both
 * carry Open in New Tab, so a preview is never a dead end.
 */
export { DocumentPreview, type DocumentPreviewProps } from "./DocumentPreview";
export { ImageViewer, type ImageViewerProps } from "./ImageViewer";
export { Paper, PaperLogo, PaperTitle, PaperTable, PaperFoot, Signature, type PaperProps, type PaperLogoProps, type PaperTitleProps, type PaperTableProps, type PaperFootProps, type SignatureProps } from "./Paper";
export { Reader, ArticleBody, type ReaderProps, type ReaderGroup, type ArticleBodyProps } from "./Reader";
