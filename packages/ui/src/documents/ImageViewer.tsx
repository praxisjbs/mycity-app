/**
 * @component ImageViewer
 * @group Documents
 * @summary A picture at a readable size, with zoom and a way to open it full size in a new tab.
 * @use A photographed receipt, a worksite picture, a scanned certificate, an uploaded profile photograph.
 * @avoid An illustration or an icon (use Illustration or Icon); a picture nobody needs to look at closely; a gallery of many (page them).
 * @phone Fits the width and zooms by the buttons rather than by pinching, so the page itself never zooms away under the person.
 * @a11y The picture carries the file's name as its text, the zoom buttons say what they do, and the zoom is announced as a percentage.
 * @status stable
 * @example <ImageViewer src={`/api/v1/documents/${id}/file`} alt="Receipt.jpg" />
 */
import { useState, type CSSProperties } from "react";
import { cn } from "../lib/cn";
import { IconButton } from "../actions/Button";
import { Button } from "../actions/Button";

/** How far a picture may be zoomed, and in what steps. */
const STEPS = [100, 150, 200, 300] as const;

export interface ImageViewerProps {
  /** Where the picture is (the vault's own stream). */
  src: string;
  /** The file's name, which is the picture's text. */
  alt: string;
  /** How tall the frame is; `md` unless a sheet wants it shorter. */
  height?: "sm" | "md" | "lg";
  /** Hide Open in New Tab (DocumentPreview's bar already carries one). */
  noOpen?: boolean;
  /** Layout classes only (spacing). */
  className?: string;
}

const HEIGHT = { sm: "h-64", md: "h-96", lg: "h-168" } as const;

export function ImageViewer({ src, alt, height = "md", noOpen, className }: ImageViewerProps) {
  const [step, setStep] = useState(0);
  const zoom = STEPS[step] ?? 100;

  return (
    <div className={cn("relative bg-muted", className)}>
      <div className={cn("flex items-center justify-center overflow-auto", HEIGHT[height])}>
        <img
          src={src}
          alt={alt}
          data-copy="content"
          style={{ "--zoom": `${zoom}%` } as CSSProperties}
          className={cn("max-h-full max-w-full object-contain", zoom > 100 && "max-h-none max-w-none w-(--zoom)")}
        />
      </div>
      <div className="absolute right-2 bottom-2 flex items-center gap-1 rounded-full border border-border bg-card px-1.5 py-1 shadow-2">
        <IconButton label="Zoom Out" icon="zoomout" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))} />
        <span aria-live="polite" className="min-w-10 text-center text-2xs font-semibold tabular-nums">
          {zoom}%
        </span>
        <IconButton label="Zoom In" icon="zoomin" disabled={step === STEPS.length - 1} onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))} />
        {!noOpen && (
          <Button asChild size="sm" iconRight="external">
            <a href={src} target="_blank" rel="noreferrer">
              Open Full
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
