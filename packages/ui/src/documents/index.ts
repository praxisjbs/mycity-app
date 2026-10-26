/**
 * The Documents group: what the product generated (Paper, which prints), what
 * someone uploaded (DocumentPreview beside a list, MediaViewer full screen,
 * FileCard in a conversation) and what someone wrote (Reader).
 *
 * PR 3 question 4, as changed on 19/10/2026: a PDF's pages are drawn by PDF.js
 * (PdfViewer, its own chunk), the same on every device; a picture goes to the
 * image viewer; anything else becomes a Download card, so a file is never a
 * dead end.
 */
export { DocumentPreview, type DocumentPreviewProps } from "./DocumentPreview";
export { ImageViewer, type ImageViewerProps } from "./ImageViewer";
export { Paper, PaperLogo, PaperTitle, PaperTable, PaperFoot, Signature, type PaperProps, type PaperLogoProps, type PaperTitleProps, type PaperTableProps, type PaperFootProps, type SignatureProps } from "./Paper";
export { Reader, ArticleBody, type ReaderProps, type ReaderGroup, type ArticleBodyProps } from "./Reader";
export * from "./EmailFrame";
export * from "./FileCard";
export * from "./GuideBody";
export * from "./GuideResults";
export * from "./MediaViewer";
export * from "./PdfViewer";
export * from "./RichText";
