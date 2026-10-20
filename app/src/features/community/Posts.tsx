import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { useFileUrl } from "@/api/download";
import type { Message } from "@/api/types/community";
import { usePhoto, usePhotos } from "@/api/download";
import { Avatar, Button, Card, cn, Confetti, formatDate, formatDateTime, formatTime, Icon, LinkText, Pill, ShareBar, Tooltip, Waveform } from "@mycity/ui";
import { AlbumMedia, MessageLink, MessageMedia } from "./Media";

/** Highlight search hits inside a heading (a message's own text is LinkText, which also opens its links). */
export function Hl({ text, q }: { text: string; q: string }) {
  if (!q.trim()) return <>{text}</>;
  const parts = text.split(new RegExp(`(${q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i} className="hit">{p}</mark> : p))}</>;
}


/** Birthday and work anniversary posts: the celebration card. */
function Celebration({ m, onCelebrate }: { m: Message; onCelebrate: () => void }) {
  const c = m.celebration!;
  const photo = usePhotos([c.subject.photo_url, ...c.fans.map((f) => f.photo_url)]);
  const bday = m.message_type === "birthday";
  const first = c.subject.display_name.split(" ")[0];
  const names = c.fans.slice(0, 2).map((f) => f.display_name.split(" ")[0]);
  const more = c.count - names.length;
  const who = c.count ? `${names.join(", ")}${more > 0 ? ` and ${more} other${more > 1 ? "s" : ""}` : ""} celebrated` : "Be the first to celebrate";
  return (
    <div
      className={cn(
        "sheen relative isolate flex max-w-144 animate-celeb-in items-center gap-4 overflow-hidden rounded-sheet p-4.5 pb-4 text-on-deep max-md:gap-3 max-md:p-3.5",
        bday ? "celebrate-warm" : "celebrate-cool",
      )}
    >
      <Confetti shape={bday ? "paper" : "stars"} />
      <span className="relative flex-none">
        <span className={cn("relative block size-18 animate-spin-slow rounded-full p-1 max-md:size-14", bday ? "ring-warm" : "ring-cool")}>
          <Avatar name={c.subject.display_name} src={photo(c.subject.photo_url)} size="2xl" tone="brand" className="flex size-full animate-spin-slow-reverse border-2 border-deep text-2xl" />
        </span>
        <span className="absolute -right-1.5 -bottom-1 flex size-7 animate-bob items-center justify-center rounded-full bg-white text-md shadow-3" aria-hidden="true">
          {bday ? "🎂" : "🏆"}
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-2xs font-bold tracking-caps uppercase", bday ? "bg-primary text-primary-foreground" : "bg-chart-2 text-deep")}>
          {bday ? "Birthday" : "Work Anniversary"}
        </span>
        <h2 data-copy="content" className="mt-2 text-xl leading-tight tracking-tight max-md:text-lg">
          {bday ? <>Happy birthday, <em className="text-primary not-italic">{first}</em></> : c.years ? <><em className="text-primary not-italic">{c.years} {c.years === 1 ? "year" : "years"}</em> at MyCity, {first}</> : <><em className="text-primary not-italic">Another year</em> at MyCity, {first}</>}
        </h2>
        <p className="mt-1 text-sm text-on-deep-soft">{m.body}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <button type="button" onClick={onCelebrate} className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-strong", c.mine ? "border-primary bg-primary text-primary-foreground" : "border-white/20 bg-white/10 text-on-deep")}>
            {bday ? "🎉" : "👏"} Celebrate · {c.count}
          </button>
          {c.fans.length > 0 && (
            <span className="flex items-center">
              {c.fans.slice(0, 3).map((f, i) => (
                <Avatar key={f.employee_id} name={f.display_name} src={photo(f.photo_url)} size="xs" className={cn("size-5.5 border-2 border-deep", i > 0 && "-ml-1.5")} />
              ))}
            </span>
          )}
          <small className="text-2xs text-on-deep-dim">{who}</small>
        </div>
      </div>
    </div>
  );
}

/**
 * A voice note plays the moment Play is pressed: its bytes are fetched as it is drawn (the
 * playable Opus when the worker has made it), and the bars follow the audio's own position
 * from its first sound, not from the press.
 */
function useVoicePlayer(m: Message) {
  const secs = m.duration_s || 1;
  const doc = m.document;
  const live = import.meta.env.VITE_API_MODE !== "mock";
  const url = doc && live ? `/api/v1/documents/${doc.document_id}/${doc.variants.includes("opus") ? "variant/opus" : "content"}` : null;
  const href = useFileUrl(url);
  const audio = useRef<HTMLAudioElement | null>(null);
  const wanted = useRef(false);
  const frame = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!href) return;
    const a = new Audio();
    a.preload = "auto";
    a.src = href;
    const follow = () => {
      const length = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : secs;
      setProgress(a.currentTime / length);
      frame.current = requestAnimationFrame(follow);
    };
    a.onplaying = () => {
      setPlaying(true);
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(follow);
    };
    a.onpause = () => {
      cancelAnimationFrame(frame.current);
      setPlaying(false);
    };
    a.onended = () => {
      cancelAnimationFrame(frame.current);
      setPlaying(false);
      setProgress(0);
    };
    audio.current = a;
    if (wanted.current) void a.play().catch(() => setPlaying(false));
    return () => {
      cancelAnimationFrame(frame.current);
      a.pause();
      audio.current = null;
    };
  }, [href, secs]);

  /* The in-browser mock holds no bytes: the bars run over the note's length instead. */
  const pretend = () => {
    const from = performance.now();
    setPlaying(true);
    const step = (now: number) => {
      const p = (now - from) / (secs * 1000);
      if (p >= 1 || !wanted.current) {
        wanted.current = false;
        setPlaying(false);
        return setProgress(0);
      }
      setProgress(p);
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  };

  const toggle = () => {
    if (playing) {
      wanted.current = false;
      audio.current?.pause();
      return;
    }
    wanted.current = true;
    if (audio.current) void audio.current.play().catch(() => setPlaying(false));
    else if (!live || !doc) pretend();
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return { playing, progress, toggle, secs };
}

function VoiceNote({ m, mine }: { m: Message; mine: boolean }) {
  const [tr, setTr] = useState<"hidden" | "loading" | "shown">("hidden");
  const [text, setText] = useState(m.transcript ?? "");
  const { playing, progress, toggle: play, secs } = useVoicePlayer(m);
  const transcribe = async () => {
    if (tr === "shown") return setTr("hidden");
    if (text) return setTr("shown");
    setTr("loading");
    const r = await api.call("POST /api/v1/community/messages/:id/transcript", { params: { id: m.community_message_id }, body: {} });
    setText(r.transcript);
    setTr("shown");
  };
  return (
    <>
      <div className="flex min-w-48 items-center gap-2">
        <button type="button" onClick={play} aria-label={playing ? "Pause voice note" : "Play voice note"} className={cn("flex size-7.5 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground", playing && "ring-4 ring-primary/25")}>
          <Icon name={playing ? "pause" : "play"} />
        </button>
        <Waveform seconds={secs} peaks={m.document?.waveform} progress={progress} />
        <em className="text-2xs not-italic opacity-80">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</em>
      </div>
      {tr === "loading" && <p className="shimmer mt-2 max-w-80 rounded-ctl px-2.5 py-2 text-xs leading-normal opacity-75">Transcribing…</p>}
      {tr === "shown" && <p className={cn("mt-2 max-w-80 rounded-ctl px-2.5 py-2 text-xs leading-normal", mine ? "bg-white/10" : "bg-black/5")}>{text}</p>}
      <button type="button" onClick={transcribe} className="mt-1.5 inline-flex items-center gap-1 text-2xs font-strong underline underline-offset-2 opacity-85">
        {tr === "shown" ? "Hide Transcript" : <><Icon name="doc" className="size-3" />Transcribe</>}
      </button>
    </>
  );
}

/**
 * An announcement in #announcements, at its level: amber when important, red and pulsing when
 * urgent, with Acknowledge for each person in its audience until they press it (community.md §3).
 */
function AnnouncementPost({ m, q }: { m: Message; q: string }) {
  const a = m.announcement;
  const asks = a?.urgency === "urgent" && a.in_audience;
  const acknowledge = () =>
    api
      .call("POST /api/v1/community/announcements/:id/acknowledge", { params: { id: a!.announcement_id }, body: {} })
      .then(() => invalidate("/api/v1/community", "/api/v1/notifications"));
  return (
    <Card urgency={a?.urgency ?? "normal"} className="max-w-152">
      <div className="mb-1.5 flex items-center gap-2 text-2xs text-subtle-foreground">
        <Icon name="flag" />
        {m.author?.display_name} · {formatDate(m.sent_at)}
        {a?.urgency === "urgent" && <Pill tone="err">Urgent</Pill>}
        {a?.urgency === "important" && <Pill tone="warn">Important</Pill>}
      </div>
      <h3 data-copy="content" className="text-base"><Hl text={a?.title ?? ""} q={q} /></h3>
      <p className="mt-1 text-sm leading-normal whitespace-pre-wrap text-muted-foreground"><LinkText text={m.body ?? ""} highlight={q} /></p>
      {asks &&
        (a.acknowledged_at ? (
          <p className="mt-2.5 flex items-center gap-1.5 text-xs text-success">
            <Icon name="tick" />Acknowledged {formatDateTime(a.acknowledged_at)}
          </p>
        ) : (
          <Button variant="primary" size="sm" className="mt-2.5 phone:w-full" onClick={acknowledge}>
            Acknowledge
          </Button>
        ))}
    </Card>
  );
}

/** The mark on a forwarded copy (§3 step 19); who first sent it is never shown. */
function Forwarded({ media }: { media?: boolean }) {
  return (
    <span className={cn("flex items-center gap-1 text-2xs italic opacity-75", media ? "px-2 pt-1 pb-1.5" : "mb-0.5")}>
      <Icon name="forward" className="size-3" />
      Forwarded
    </span>
  );
}

const TICK = { sent: ["tick", "Sent"], delivered: ["ticks", "Delivered"], read: ["ticks", "Read"] } as const;

/** A sent message's ticks, in a direct conversation (§3 step 10). */
function Ticks({ status }: { status: NonNullable<Message["status"]> }) {
  return (
    <Tooltip label={TICK[status][1]}>
      <span role="img" className={cn("ml-1 inline-flex align-text-bottom", status === "read" ? "text-info" : "text-subtle-foreground")} aria-label={TICK[status][1]}>
        <Icon name={TICK[status][0]} className="size-3.5" />
      </span>
    </Tooltip>
  );
}

const bubble = (mine: boolean) =>
  mine ? "bubble-me border border-secondary bg-secondary text-secondary-foreground" : "bubble-them border border-border bg-muted text-foreground";

/** Four or more photos and videos sent together: one bubble, two by two, the caption under it (§3 step 17). */
export function AlbumPost({ ms, q, dm, onView, menu }: { ms: Message[]; q: string; dm?: boolean; onView: (key: string) => void; menu?: ReactNode }) {
  const first = ms[0]!;
  const last = ms[ms.length - 1]!;
  const authorPhoto = usePhoto(first.mine ? null : first.author?.photo_url);
  const caption = ms.find((x) => x.body)?.body ?? null;
  return (
    <div className={cn("flex max-w-4/5 gap-2 max-md:max-w-11/12", first.mine && "flex-row-reverse self-end")}>
      {!first.mine && <Avatar name={first.author?.display_name ?? "MyCity"} src={authorPhoto} size={30} className="mt-0.5" />}
      <div className="min-w-0">
        <div className={cn("mb-0.5 flex items-baseline gap-1.5 text-xs font-strong", first.mine && "justify-end")}>
          {!first.mine && first.author?.display_name}
          <span className="text-2xs font-normal text-subtle-foreground">
            {formatTime(last.sent_at)}
            {first.mine && dm && last.status && <Ticks status={last.status} />}
          </span>
          {menu}
        </div>
        <div className={cn("w-min p-1 text-sm leading-normal wrap-any", bubble(first.mine))}>
          {first.forwarded && <Forwarded media />}
          <AlbumMedia ms={ms} onView={onView} />
          {caption && (
            <div className="px-2 pt-1.5 pb-0.5 whitespace-pre-wrap">
              <LinkText text={caption} highlight={q} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** One post in a channel or a conversation. */
export function Post({ m, q, dm, onCelebrate, onVote, onView, menu }: { m: Message; q: string; dm?: boolean; onCelebrate: () => void; onVote: (i: number) => void; onView?: (key: string) => void; menu?: ReactNode }) {
  const authorPhoto = usePhoto(m.mine ? null : m.author?.photo_url);
  const toPhoto = usePhoto(m.recognition?.to.photo_url);
  /* A card keeps its look; its menu sits beside it. */
  const withMenu = (card: ReactNode) => (menu ? <div className={cn("flex items-start gap-1", m.mine && "flex-row-reverse")}>{card}{menu}</div> : card);
  if (!m.deleted && (m.message_type === "birthday" || m.message_type === "anniversary")) return m.celebration ? withMenu(<Celebration m={m} onCelebrate={onCelebrate} />) : null;
  if (!m.deleted && m.message_type === "recognition" && m.recognition) {
    const r = m.recognition!;
    return withMenu(
      <div className="max-w-136 rounded-card border border-l-2 border-border border-l-primary bg-accent px-3.5 py-3">
        <div className="flex items-center gap-2 text-sm">
          <Avatar name={r.to.display_name} src={toPhoto} size={26} />
          <span><b>{m.author?.display_name}</b> recognised <b>{r.to.display_name}</b></span>
        </div>
        <q className="mt-1.5 mb-2 block text-sm text-foreground">{m.body}</q>
        <button type="button" onClick={onCelebrate} className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-strong", r.mine ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted")}>👍 {r.count}</button>
      </div>,
    );
  }
  if (!m.deleted && m.message_type === "poll" && m.poll) {
    const p = m.poll!;
    const votes = p.options.reduce((a, o) => a + o.votes, 0);
    const tot = votes || 1;
    const card = (
      <div className="w-full min-w-0 flex-1 rounded-card border border-border bg-background px-3.5 py-3">
        <div className="mb-1 flex items-center gap-2 text-2xs text-subtle-foreground">
          <span className="flex-1">Poll by {m.author?.display_name} · {votes} vote{votes === 1 ? "" : "s"}{m.edited_at ? " · Edited" : ""}</span>
          {p.closed && <Pill>Closed</Pill>}
        </div>
        <h3 data-copy="content" className="mb-2 text-sm">{p.question}</h3>
        {p.options.map((o, i) => {
          const pc = Math.round((o.votes * 100) / tot);
          return (
            <button key={i} type="button" disabled={p.closed} onClick={() => onVote(i)} aria-pressed={p.my_vote === i} className={cn("relative mb-1.5 block w-full overflow-hidden rounded-box border px-2.5 py-2 text-left text-xs phone:min-h-tap", p.my_vote === i ? "border-secondary" : "border-border")}>
              <ShareBar percent={pc} />
              <span className={cn("relative flex justify-between gap-2", p.my_vote === i && "font-strong")}><span>{o.text}</span><span>{pc}%</span></span>
            </button>
          );
        })}
      </div>
    );
    /* A poll reads as a block up to 560 px, as in the demo, not shrunk to its words. */
    return <div className={cn("flex w-full max-w-140 items-start gap-1", m.mine && "flex-row-reverse")}>{card}{menu}</div>;
  }
  if (m.message_type === "announcement") return <AnnouncementPost m={m} q={q} />;
  /* A photo, a video or a file fills its bubble, its caption under it; a text carries its first link's card above it. */
  const media = !m.deleted && m.message_type !== "audio" && Boolean(m.document);
  let inner: ReactNode;
  if (m.deleted) inner = <span className="italic opacity-70">Message deleted</span>;
  else if (m.message_type === "audio") inner = <VoiceNote m={m} mine={m.mine} />;
  else if (media)
    inner = (
      <>
        <MessageMedia m={m} onView={() => onView?.(m.community_message_id)} />
        {m.body && (
          <div className="px-2 pt-1.5 pb-0.5 whitespace-pre-wrap">
            <LinkText text={m.body} highlight={q} />
          </div>
        )}
      </>
    );
  else
    inner = (
      <>
        {m.link && (
          <div className="mb-1.5">
            <MessageLink link={m.link} mine={m.mine} />
          </div>
        )}
        <LinkText text={m.body ?? ""} highlight={q} />
      </>
    );
  return (
    <div className={cn("flex max-w-4/5 gap-2 max-md:max-w-11/12", m.mine && "flex-row-reverse self-end")}>
      {!m.mine && <Avatar name={m.author?.display_name ?? "MyCity"} src={authorPhoto} size={30} className="mt-0.5" />}
      <div className="min-w-0">
        <div className={cn("mb-0.5 flex items-baseline gap-1.5 text-xs font-strong", m.mine && "justify-end")}>
          {!m.mine && m.author?.display_name}
          <span className="text-2xs font-normal text-subtle-foreground">
            {formatTime(m.sent_at)}
            {m.edited_at && !m.deleted && " · Edited"}
            {m.mine && dm && m.status && <Ticks status={m.status} />}
          </span>
          {menu}
        </div>
        <div className={cn("text-sm leading-normal wrap-any", media ? "w-min p-1" : "px-3 py-2 whitespace-pre-wrap", bubble(m.mine))}>
          {m.forwarded && !m.deleted && <Forwarded media={media} />}
          {inner}
        </div>
      </div>
    </div>
  );
}
