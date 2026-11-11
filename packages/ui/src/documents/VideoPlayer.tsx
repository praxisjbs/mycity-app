/**
 * @component VideoPlayer
 * @group Documents
 * @summary A video inside a page, nothing loaded until Play Video is pressed: a YouTube video through YouTube's privacy-enhanced domain, or an uploaded MP4 fetched with the session.
 * @use A course's video item (ESS · My Training), a short walkthrough a page plays in place.
 * @avoid A chat's or a document list's video opened full screen (MediaViewer); a video's first frame in a list (MediaTile); any site but YouTube in a frame (open it in a new tab).
 * @phone Full width at 16:9, with Play Video a 44 px target in the middle; the video's own controls play it, and full screen is the phone's.
 * @a11y The player is named by `title`: Play Video's name carries it, and the frame and the video are labelled by it (no title tooltip). Nothing plays or loads by itself; while an MP4 arrives the box says aria-busy, and one that fails says so in words with Try Again.
 * @status beta
 * @example <VideoPlayer key={item.id} title="Why Data Matters" youtubeId="dQw4w9WgXcQ" />
 */
import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { content } from "../lib/slots";
import { Button } from "../actions/Button";
import { Spinner } from "../display/Skeleton";

/** Where a YouTube video plays: its privacy-enhanced domain, which sets no cookie until play. */
export const YOUTUBE_EMBED = "https://www.youtube-nocookie.com/embed/";
/** What a YouTube video id looks like; anything else is never put in a frame's address. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,20}$/;

export interface VideoPlayerProps {
  /** The video's title: the player's accessible name, and the line over its Play button. */
  title: string;
  /** A YouTube video's id (the API reads it from the link): it plays from youtube-nocookie.com. */
  youtubeId?: string | null;
  /** An uploaded video's bytes, fetched with the session only when Play Video is pressed (an MP4). Key the player by the video, so another one starts again from its poster. */
  load?: () => Promise<Blob>;
  /** Layout classes only (spacing, width); the look is the component's own. */
  className?: string;
}

type State = { at: "idle" } | { at: "loading" } | { at: "failed" } | { at: "playing"; url: string | null };

export function VideoPlayer({ title, youtubeId, load, className }: VideoPlayerProps) {
  const youtube = youtubeId && YOUTUBE_ID.test(youtubeId) ? youtubeId : null;
  const [state, setState] = useState<State>({ at: "idle" });
  const made = useRef<string | null>(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (made.current) URL.revokeObjectURL(made.current);
      made.current = null;
    };
  }, []);

  const play = async () => {
    if (youtube) return setState({ at: "playing", url: null });
    if (!load) return;
    setState({ at: "loading" });
    try {
      const blob = await load();
      if (!live.current) return;
      if (made.current) URL.revokeObjectURL(made.current);
      made.current = URL.createObjectURL(blob);
      setState({ at: "playing", url: made.current });
    } catch {
      if (live.current) setState({ at: "failed" });
    }
  };

  const box = cn("relative aspect-video w-full overflow-hidden rounded-box bg-deep text-on-deep", className);

  if (state.at === "playing" && youtube)
    return (
      <div className={box} data-pull="off">
        <iframe
          src={`${YOUTUBE_EMBED}${youtube}?rel=0&autoplay=1`}
          aria-label={title}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 size-full border-0"
        />
      </div>
    );

  if (state.at === "playing" && state.url)
    return (
      <div className={box} data-pull="off">
        <video src={state.url} aria-label={title} controls playsInline autoPlay className="absolute inset-0 size-full" />
      </div>
    );

  const playable = Boolean(youtube || load);
  return (
    <div className={box} aria-busy={state.at === "loading" || undefined}>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
        <span {...content} className="line-clamp-2 max-w-full text-sm font-semibold wrap-any">
          {title}
        </span>
        {state.at === "loading" ? (
          <Spinner label="Opening video" className="text-on-deep-muted" />
        ) : state.at === "failed" ? (
          <span role="alert" className="flex flex-col items-center gap-2 text-xs text-on-deep-muted">
            Video did not load
            <Button size="sm" icon="refresh" onClick={play}>
              Try Again
            </Button>
          </span>
        ) : playable ? (
          <Button variant="primary" icon="play" onClick={play} aria-label={`Play Video, ${title}`}>
            Play Video
          </Button>
        ) : (
          <span className="text-xs text-on-deep-muted">No video here</span>
        )}
      </div>
    </div>
  );
}
