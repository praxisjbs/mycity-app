import { useCallback, useMemo, useState } from "react";
import { cachedPhoto, fetchFile, saveBlob, saveFile, usePhoto, usePhotos } from "@/api/download";
import { upload } from "@/api/upload";
import type { LinkPreview, MediaRef, Message, MessageCreate } from "@/api/types/community";
import { ApiError } from "@/api/client";
import { Button, Field, FileCard, fileTypeOf, formatBytes, formatDate, formatTime, FormError, FormFooter, Icon, LinkCard, MediaAlbum, MediaTile, MediaViewer, TextAreaField, toast, todayIso, UploadField, useContractForm, type ViewerItem } from "@mycity/ui";

/**
 * Staff Community's photos, videos, files and link cards (community.md §3 steps 17 and 18):
 * which of a file's sizes a bubble shows, what the file viewer fetches, and Send Files. The
 * files are gated, so every picture and file is fetched with the session (api/download.ts),
 * a picture only once it comes near the screen.
 */

const contentUrl = (id: string) => `/api/v1/documents/${id}/content`;
const variantUrl = (id: string, kind: string) => `/api/v1/documents/${id}/variant/${kind}`;
type FileKind = "image" | "video" | "file";

/** The picture a bubble shows: a photo's or a PDF's first page's 960 px size, a video's poster; else the photo itself. */
export function pictureOf(doc: MediaRef, kind: FileKind): string | null {
  if (kind === "video") return doc.variants.includes("poster") ? variantUrl(doc.document_id, "poster") : null;
  if (doc.variants.includes("webp-960")) return variantUrl(doc.document_id, "webp-960");
  // A photo too small to have a 960 px size, or a GIF, which keeps its frames: the file itself.
  return kind === "image" ? contentUrl(doc.document_id) : null;
}

/** A tile's picture (Send Files, a profile): the 320 px size, else the photo itself. */
export function thumbOf(doc: MediaRef): string | null {
  if (doc.variants.includes("webp-320")) return variantUrl(doc.document_id, "webp-320");
  return doc.mime_type.startsWith("image/") ? contentUrl(doc.document_id) : null;
}

/** What the viewer fetches: a video's playable MP4 once the worker has made it, else the file. */
const fileUrlOf = (doc: MediaRef) =>
  doc.mime_type.startsWith("video/") && doc.variants.includes("mp4-720") ? variantUrl(doc.document_id, "mp4-720") : contentUrl(doc.document_id);

const kindOf = (doc: MediaRef): FileKind => (doc.mime_type.startsWith("image/") ? "image" : doc.mime_type.startsWith("video/") ? "video" : "file");

/** A video's length as it is read: 0:42, 12:05. */
const clock = (ms: number | null) => {
  if (!ms) return null;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** The files the viewer opens in the app: photos, videos and PDFs. */
const viewable = (doc: MediaRef) => kindOf(doc) !== "file" || doc.mime_type === "application/pdf";

/** When a message was sent, as the viewer's second line says it. */
function sentLine(iso: string) {
  const day = todayIso(new Date(iso));
  const today = todayIso();
  const yesterday = todayIso(new Date(Date.now() - 86400000));
  return `${day === today ? "Today" : day === yesterday ? "Yesterday" : formatDate(day)}, ${formatTime(iso)}`;
}

/**
 * The file viewer over a set of files: `open(key)` shows one, and the viewer steps through
 * the rest in order. `files` maps a key to its file, who sent it, when and its caption;
 * `onForward`, when given, offers Forward for the file on view, by its key.
 */
export function useViewer(files: Array<{ key: string; doc: MediaRef; by?: string | null; at?: string | null; caption?: string | null }>, onForward?: (key: string) => void) {
  const [at, setAt] = useState<number | null>(null);
  const shown = useMemo(() => files.filter((f) => viewable(f.doc)), [files]);
  const items: ViewerItem[] = useMemo(
    () =>
      shown.map((f) => {
        const picture = pictureOf(f.doc, kindOf(f.doc));
        return { key: f.key, name: f.doc.file_name, mime: f.doc.mime_type, by: f.by ?? null, at: f.at ?? null, caption: f.caption ?? null, poster: cachedPhoto(picture) };
      }),
    [shown],
  );
  const load = useCallback(
    (item: ViewerItem) => {
      const f = shown.find((x) => x.key === item.key);
      return f ? fetchFile(fileUrlOf(f.doc)) : Promise.reject(new Error("gone"));
    },
    [shown],
  );
  const open = useCallback(
    (key: string) => {
      const i = shown.findIndex((f) => f.key === key);
      if (i >= 0) setAt(i);
    },
    [shown],
  );
  const viewer = <MediaViewer open={at !== null && at < items.length} items={items} index={at ?? 0} onIndex={setAt} onClose={() => setAt(null)} load={load} save={saveBlob} onForward={onForward ? (item) => onForward(item.key) : undefined} />;
  return { open, viewer };
}

/** A conversation's files for the viewer, in the order they were sent. */
export function viewerFilesOf(msgs: Message[]) {
  return msgs
    .filter((m) => !m.deleted && m.document)
    .map((m) => ({ key: m.community_message_id, doc: m.document!, by: m.mine ? "You" : (m.author?.display_name ?? "MyCity"), at: sentLine(m.sent_at), caption: m.body }));
}

/** A message's photo, video or file, in its bubble. */
export function MessageMedia({ m, onView }: { m: Message; onView: () => void }) {
  const doc = m.document!;
  const kind = kindOf(doc);
  const picture = pictureOf(doc, kind);
  const [wanted, setWanted] = useState(false);
  const src = usePhoto(wanted ? picture : null);
  const seen = () => setWanted(true);
  const save = async () => {
    await saveFile(contentUrl(doc.document_id), doc.file_name);
  };
  if (kind === "image") return <MediaTile src={src} alt={doc.file_name} width={doc.width} height={doc.height} onOpen={onView} onSeen={seen} />;
  if (kind === "video") return <MediaTile kind="video" src={src} alt={doc.file_name} width={doc.width} height={doc.height} duration={clock(doc.duration_ms)} onOpen={onView} onSeen={seen} />;
  return (
    <FileCard
      name={doc.file_name}
      mime={doc.mime_type}
      sizeBytes={doc.size_bytes}
      pages={doc.page_count}
      hasPreview={Boolean(picture)}
      preview={src}
      tone={m.mine ? "mine" : "theirs"}
      onSeen={seen}
      onOpen={viewable(doc) ? onView : save}
      onDownload={save}
    />
  );
}

/** Four or more photos and videos sent together, two by two. */
export function AlbumMedia({ ms, onView }: { ms: Message[]; onView: (key: string) => void }) {
  const [wanted, setWanted] = useState(false);
  const pictures = ms.map((m) => pictureOf(m.document!, kindOf(m.document!)));
  const photo = usePhotos(wanted ? pictures : []);
  return (
    <MediaAlbum
      tiles={ms.map((m, i) => ({
        key: m.community_message_id,
        src: photo(pictures[i]),
        alt: m.document!.file_name,
        kind: kindOf(m.document!) === "video" ? "video" : "photo",
        duration: clock(m.document!.duration_ms),
        onOpen: () => onView(m.community_message_id),
        onSeen: () => setWanted(true),
      }))}
    />
  );
}

/** A message's link card, its picture fetched once it comes near the screen. */
export function MessageLink({ link, mine, onRemove, loading }: { link: LinkPreview | null; mine?: boolean; onRemove?: () => void; loading?: { url: string } }) {
  const [wanted, setWanted] = useState(Boolean(onRemove));
  const img = link?.image ?? null;
  const picture = img ? (img.variants.includes("webp-960") ? variantUrl(img.document_id, "webp-960") : contentUrl(img.document_id)) : null;
  const src = usePhoto(wanted ? picture : null);
  if (loading) return <LinkCard href={loading.url} loading tone="plain" onRemove={onRemove} />;
  if (!link) return null;
  return (
    <LinkCard
      href={link.url}
      title={link.title}
      site={link.site_name}
      description={link.description}
      hasImage={Boolean(img)}
      image={src}
      imageWidth={img?.width}
      imageHeight={img?.height}
      tone={onRemove ? "plain" : mine ? "mine" : "theirs"}
      onRemove={onRemove}
      onSeen={() => setWanted(true)}
    />
  );
}

/** A profile's Shared in Conversation: a photo, video or PDF opens the viewer; any other file downloads. */
export function SharedFiles({ files }: { files: MediaRef[] }) {
  const list = useMemo(() => files.map((doc) => ({ key: doc.document_id, doc })), [files]);
  const { open, viewer } = useViewer(list);
  return (
    <>
      {files.map((doc) => (
        <button
          key={doc.document_id}
          type="button"
          data-copy="content"
          onClick={() => (viewable(doc) ? open(doc.document_id) : saveFile(contentUrl(doc.document_id), doc.file_name))}
          className="flex w-full min-w-0 items-center gap-2.5 rounded-ctl py-1 text-left text-sm hover:bg-muted max-md:min-h-11"
        >
          <Icon name={fileTypeOf(doc.mime_type, doc.file_name).glyph} className="flex-none text-subtle-foreground" />
          <span className="min-w-0 truncate">{doc.file_name}</span>
          <span className="ml-auto flex-none text-2xs text-subtle-foreground">{formatBytes(doc.size_bytes)}</span>
        </button>
      ))}
      {viewer}
    </>
  );
}

/** One file picked in Send Files: its picture or its glyph, and Remove. */
function Picked({ doc, onRemove }: { doc: MediaRef; onRemove: () => void }) {
  const src = usePhoto(thumbOf(doc));
  const kind = kindOf(doc);
  return <MediaTile fit="square" src={src} alt={doc.file_name} kind={kind === "image" ? "photo" : kind === "video" ? "video" : "file"} glyph={fileTypeOf(doc.mime_type, doc.file_name).glyph} onRemove={onRemove} />;
}

/**
 * Send Files (§3 step 17): pick one or more files, see them, add a caption, send. Each file
 * posts as its own message, in the order picked, sharing one album key; the caption rides on
 * the first.
 */
export function SendFiles({ channelId, accept, kinds, close, send }: { channelId: string; accept?: string; kinds?: string; close: () => void; send: (bodies: MessageCreate[]) => Promise<void> }) {
  const [docs, setDocs] = useState<MediaRef[]>([]);
  const [none, setNone] = useState(false);
  const f = useContractForm({ caption: "" }, { caption: (v) => (v.length > 4000 ? "Too long" : null) });
  const sendAll = async () => {
    if (!docs.length) {
      setNone(true);
      return;
    }
    if (!f.check()) return;
    const album = docs.length > 1 ? crypto.randomUUID() : undefined;
    const caption = f.values.caption.trim();
    try {
      await send(
        docs.map((d, i) => ({
          message_type: "file",
          document_id: d.document_id,
          ...(album ? { album_key: album } : {}),
          ...(i === 0 && caption ? { body: caption } : {}),
        })),
      );
      close();
    } catch (e) {
      // The sheet stays, with what was picked, and says why.
      toast.error(e instanceof ApiError ? e.message : "Not sent. Try again.");
    }
  };
  return (
    <>
      <UploadField
        upload={upload}
        purpose="attachment"
        endpoint={`/api/v1/community/channels/${channelId}/media`}
        accept={accept}
        kinds={kinds}
        label={docs.length ? "Add more files" : "Choose files to send"}
        compact={docs.length > 0}
        autoOpen
        handOff
        // The conversation's upload answers a MediaRef (its shape and sizes), the upload field's DocumentRef and more.
        onUploaded={(arrived) => {
          setNone(false);
          setDocs((list) => [...list, ...(arrived as MediaRef[])]);
        }}
      />
      {docs.length > 0 && (
        <div className="grid grid-cols-3 gap-1 desk:grid-cols-4">
          {docs.map((d) => (
            <Picked key={d.document_id} doc={d} onRemove={() => setDocs((list) => list.filter((x) => x.document_id !== d.document_id))} />
          ))}
        </div>
      )}
      <Field label="Caption" optional {...f.field("caption")}>
        <TextAreaField {...f.field("caption")} />
      </Field>
      <FormError>{none && !docs.length ? "Choose a file first" : null}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon="send" onClick={sendAll}>
          Send Files
        </Button>
      </FormFooter>
    </>
  );
}
