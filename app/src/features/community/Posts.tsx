import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "@/api/client";
import { invalidate, usePaged } from "@/api/hooks";
import { useFileUrl } from "@/api/download";
import type { Message, Wish } from "@/api/types/community";
import { useAuth } from "@/auth/AuthProvider";
import community from "@mycity/contract/schemas/community.js";
import { usePhoto, usePhotos } from "@/api/download";
import { ActionGroup, Avatar, Button, Card, cn, Confetti, Field, Form, formatDate, formatDateTime, FormFooter, formatTime, Icon, IconButton, LinkText, Pager, Pill, ShareBar, TextAreaField, toast, Tooltip, useConfirm, useContractForm, useModal, Waveform, YearsMedal } from "@mycity/ui";
import { AlbumMedia, MessageLink, MessageMedia } from "./Media";
import { cardSeen, markCardSeen } from "./seen";

/** Highlight search hits inside a heading (a message's own text is LinkText, which also opens its links). */
export function Hl({ text, q }: { text: string; q: string }) {
  if (!q.trim()) return <>{text}</>;
  const parts = text.split(new RegExp(`(${q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i} className="hit">{p}</mark> : p))}</>;
}


/** "Three years at MyCity today.": the years in words up to ten, as the card reads them aloud. */
const WORDS = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
];
function yearsLine(years: number | null) {
  if (!years) return "Another year at MyCity today.";
  return `${WORDS[years] ?? years} ${years === 1 ? "year" : "years"} at MyCity today.`;
}

/** Send Wishes: a short wish that stays under the card (community.md §3 step 3). */
function SendWishes({
  m,
  close,
  done,
}: {
  m: Message;
  close: () => void;
  done: (m: Message) => void;
}) {
  const f = useContractForm({ body: "" }, community.WishCreate);
  const send = f.submit(async ({ body }) => {
    try {
      done(
        await api.call("POST /api/v1/community/messages/:id/wishes", {
          params: { id: m.community_message_id },
          body: { body },
        }),
      );
      close();
      toast("Wishes sent");
    } catch (e) {
      if (e instanceof ApiError)
        f.setServerErrors(
          e.fields.body ? { body: e.fields.body } : { body: [e.message] },
        );
    }
  });
  return (
    <Form onSubmit={send}>
      <Field label="Wish" {...f.status("body")}>
        <TextAreaField {...f.field("body")} rows={3} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit" icon="msg">
          Send Wishes
        </Button>
      </FormFooter>
    </Form>
  );
}

/** Ask once, then delete a wish; the card reads its wishes again. */
function useDeleteWish(changed: () => void) {
  const confirm = useConfirm();
  return async (w: Wish) => {
    if (
      !(await confirm({
        title: "Delete Wish",
        body: "It is removed from the card for everyone.",
        confirmLabel: "Delete Wish",
        cancelLabel: "Keep It",
        destructive: true,
      }))
    )
      return;
    try {
      await api.call("DELETE /api/v1/community/wishes/:id", {
        params: { id: w.community_wish_id },
      });
      toast("Wish deleted");
      changed();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Not deleted. Try again.",
      );
    }
  };
}

/** One wish: the face, the first name and the words; Delete Wish for its author or a moderator. */
function WishRow({
  w,
  photo,
  onDelete,
  when,
  brand,
}: {
  w: Wish;
  photo: string | null | undefined;
  onDelete: (w: Wish) => Promise<void>;
  when?: boolean;
  /** On the anniversary card's City Green: the delete control takes the light ink. */
  brand?: boolean;
}) {
  return (
    <li className="flex items-start gap-2 text-sm leading-normal">
      <Avatar
        name={w.author.display_name}
        src={photo}
        size="xs"
        className="mt-0.5"
      />
      <p data-copy="content" className="min-w-0 flex-1 wrap-any">
        <b className="font-strong">
          {w.mine ? "You" : w.author.display_name.split(" ")[0]}
        </b>{" "}
        {w.body}
        {when && (
          <span className="ml-1.5 text-2xs text-subtle-foreground">
            {formatDateTime(w.created_at)}
          </span>
        )}
      </p>
      {w.can_delete && (
        <IconButton
          icon="trash"
          label="Delete Wish"
          size="sm"
          className={cn("-my-1 flex-none", brand && "text-on-deep-soft")}
          onClick={() => onDelete(w)}
        />
      )}
    </li>
  );
}

/** Wishes: every wish on the card, newest first, 25 at a time. */
function Wishes({
  m,
  close,
  changed,
}: {
  m: Message;
  close: () => void;
  changed: () => void;
}) {
  const list = usePaged("GET /api/v1/community/messages/:id/wishes", {
    params: { id: m.community_message_id },
  });
  const photo = usePhotos(list.rows.map((w) => w.author.photo_url));
  const remove = useDeleteWish(() => (list.reload(), changed()));
  return (
    <>
      <ul aria-label="Wishes" className="grid gap-3">
        {list.rows.map((w) => (
          <WishRow
            key={w.community_wish_id}
            w={w}
            photo={photo(w.author.photo_url)}
            onDelete={remove}
            when
          />
        ))}
      </ul>
      <Pager
        page={list.page}
        onPage={list.setPage}
        noun="wish"
        nounPlural="wishes"
        label="Wishes"
        className="mt-3"
      />
      <FormFooter>
        <Button variant="primary" onClick={close}>
          Close
        </Button>
      </FormFooter>
    </>
  );
}

/**
 * Birthday and work anniversary cards (community.md §3 step 3, §10), Cynthia's picks: a plain
 * birthday card, and a City Green anniversary card with the years in a laurel. Confetti bursts
 * the first time the person sees the card on this device, and from Celebrate when they press it.
 */
function Celebration({
  m,
  onCelebrate,
  onChange,
  onReload,
}: {
  m: Message;
  onCelebrate: () => Promise<unknown>;
  onChange: (m: Message) => void;
  onReload: () => void;
}) {
  const c = m.celebration!;
  const bday = m.message_type === "birthday";
  const { me } = useAuth();
  const modal = useModal();
  const photo = usePhotos([
    c.subject.photo_url,
    ...c.fans.map((f) => f.photo_url),
    ...c.wishes.map((w) => w.author.photo_url),
  ]);
  const button = useRef<HTMLButtonElement>(null);
  const origin = useRef<HTMLSpanElement>(null);
  const [presses, setPresses] = useState(0);
  const [fresh] = useState(
    () => !cardSeen(m.community_message_id, me?.user_id),
  );
  const removeWish = useDeleteWish(onReload);

  const first = c.subject.display_name.split(" ")[0];
  const names = c.fans
    .slice(0, 2)
    .map((f) =>
      f.employee_id === me?.employee_id ? "You" : f.display_name.split(" ")[0],
    );
  const more = c.count - names.length;
  const who = c.count
    ? `${names.join(", ")}${more > 0 ? ` and ${more} other${more > 1 ? "s" : ""}` : ""} celebrated`
    : "Be the first to celebrate";
  const role = bday
    ? c.subject.job_title
    : [c.subject.job_title, c.subject.department].filter(Boolean).join(", ");
  const face = (cls: string) => (
    <Avatar
      name={c.subject.display_name}
      src={photo(c.subject.photo_url)}
      tone="brand"
      className={cls}
    />
  );

  const celebrate = () => {
    if (!c.mine) setPresses((n) => n + 1);
    return onCelebrate();
  };
  const sendWishes = () =>
    modal.open({
      title: "Send Wishes",
      body: (close) => <SendWishes m={m} close={close} done={onChange} />,
    });
  const viewWishes = () =>
    modal.open({
      title: "Wishes",
      body: (close) => <Wishes m={m} close={close} changed={onReload} />,
    });

  return (
    <article
      aria-label={
        bday
          ? `Birthday, ${c.subject.display_name}`
          : `Work anniversary, ${c.subject.display_name}`
      }
      className={cn(
        "relative isolate w-full max-w-144 overflow-hidden rounded-sheet",
        bday
          ? "border border-border bg-card p-5 shadow-1 phone:p-4"
          : "bg-secondary p-6 text-secondary-foreground phone:p-5",
      )}
    >
      <Confetti
        shape={bday ? "paper" : "stars"}
        on={bday ? "card" : "brand"}
        burstOnView={fresh}
        viewFrom={origin}
        onViewBurst={() => markCardSeen(m.community_message_id, me?.user_id)}
        burst={presses}
        from={button}
      />
      {bday ? (
        <div className="flex items-center gap-4 phone:gap-3.5">
          <span
            ref={origin}
            className="relative flex-none rounded-full bg-primary p-0.75"
          >
            {face(
              "size-16 border-3 border-card text-2xl phone:size-13 phone:text-xl",
            )}
            <span
              aria-hidden="true"
              className="absolute -right-1.5 -bottom-1 grid size-7 place-items-center rounded-full bg-card text-eyebrow shadow-2"
            >
              <Icon name="cake" />
            </span>
          </span>
          <div data-copy="content" className="min-w-0">
            <h3 className="text-2xl leading-tight font-semibold tracking-tight phone:text-xl">
              Happy Birthday, {first}
            </h3>
            <p className="mt-0.5 text-base text-muted-foreground">
              {role
                ? `${c.subject.display_name}, ${role}`
                : c.subject.display_name}
            </p>
            <p className="mt-1.5 text-md">{m.body}</p>
          </div>
        </div>
      ) : (
        <div className="grid cols-figure items-center gap-x-6 gap-y-3 phone:gap-x-4">
          <span ref={origin} className="relative row-span-2 phone:row-span-1">
            <YearsMedal years={c.years} />
            {face(
              "absolute -right-2 -bottom-1.5 size-9 border-2 border-secondary text-xs desk:hidden",
            )}
          </span>
          <div className="flex min-w-0 items-center gap-3 self-end phone:self-center">
            {face("size-11 border-2 border-primary text-sm phone:hidden")}
            <div data-copy="content" className="min-w-0">
              <h3 className="text-2xl leading-tight font-semibold phone:text-xl">
                {c.subject.display_name}
              </h3>
              {role && <p className="text-base text-on-deep-soft">{role}</p>}
            </div>
          </div>
          <div data-copy="content" className="self-start phone:col-span-2">
            <p className="text-lg">
              {yearsLine(c.years)} {m.body}
            </p>
            {c.since && (
              <p className="mt-1 text-xs text-on-deep-dim">
                Joined {formatDate(c.since)}
              </p>
            )}
          </div>
        </div>
      )}
      <ActionGroup>
        <div className="mt-4.5 flex flex-wrap gap-2.5 phone:gap-2">
          <Button
            ref={button}
            variant={c.mine ? "default" : "primary"}
            icon="party"
            aria-pressed={c.mine}
            onClick={celebrate}
            className="phone:flex-1"
          >
            {c.mine ? "Celebrated" : "Celebrate"}
          </Button>
          <Button icon="msg" onClick={sendWishes} className="phone:flex-1">
            Send Wishes
          </Button>
        </div>
      </ActionGroup>
      <div
        className={cn(
          "mt-4 border-t pt-3",
          bday ? "border-border" : "border-on-deep/15",
        )}
      >
        <div className="flex items-center gap-2">
          {c.fans.length > 0 && (
            <span className="flex flex-none">
              {c.fans.map((f, i) => (
                <Avatar
                  key={f.employee_id}
                  name={f.display_name}
                  src={photo(f.photo_url)}
                  size="sm"
                  className={cn(
                    "border-2",
                    bday ? "border-card" : "border-secondary",
                    i > 0 && "-ml-2",
                  )}
                />
              ))}
            </span>
          )}
          <small
            data-copy="content"
            className={cn(
              "text-xs",
              bday ? "text-muted-foreground" : "text-on-deep-soft",
            )}
          >
            {who}
          </small>
        </div>
        {c.wishes.length > 0 && (
          <ul aria-label="Wishes" className="mt-2.5 grid gap-2">
            {c.wishes.map((w) => (
              <WishRow
                key={w.community_wish_id}
                w={w}
                photo={photo(w.author.photo_url)}
                onDelete={removeWish}
                brand={!bday}
              />
            ))}
          </ul>
        )}
        {c.wish_count > 2 && (
          <div className="mt-1.5 flex items-center gap-2">
            <small
              data-copy="content"
              className={cn(
                "text-xs",
                bday ? "text-muted-foreground" : "text-on-deep-soft",
              )}
            >
              {c.wish_count} wishes
            </small>
            <Button
              variant="ghost"
              size="sm"
              iconRight="right"
              onClick={viewWishes}
              className={bday ? undefined : "text-secondary-foreground"}
            >
              View All
            </Button>
          </div>
        )}
      </div>
    </article>
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
  /** The browser's own captions, shown when no transcription service could answer: asked again next time. */
  const [draft, setDraft] = useState(false);
  const { playing, progress, toggle: play, secs } = useVoicePlayer(m);
  const transcribe = async () => {
    if (tr === "shown") return setTr("hidden");
    if (text && !draft) return setTr("shown");
    setTr("loading");
    try {
      const r = await api.call("POST /api/v1/community/messages/:id/transcript", { params: { id: m.community_message_id }, body: {} });
      setText(r.transcript);
      setDraft(r.draft);
      setTr("shown");
    } catch (e) {
      setTr("hidden");
      toast(e instanceof ApiError ? e.message : "Could not transcribe");
    }
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
      {tr === "shown" && (
        <div className={cn("mt-2 max-w-80 rounded-ctl px-2.5 py-2 text-xs leading-normal", mine ? "bg-white/10" : "bg-black/5")}>
          {draft && (
            <Pill tone="warn" className="mb-1">
              Draft
            </Pill>
          )}
          <p data-copy="content">{text}</p>
        </div>
      )}
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
export function Post({ m, q, dm, onCelebrate, onVote, onView, onChange, onReload, menu }: { m: Message; q: string; dm?: boolean; onCelebrate: () => Promise<unknown>; onVote: (i: number) => void; onView?: (key: string) => void; onChange?: (m: Message) => void; onReload?: () => void; menu?: ReactNode }) {
  const authorPhoto = usePhoto(m.mine ? null : m.author?.photo_url);
  const toPhoto = usePhoto(m.recognition?.to.photo_url);
  /* A card keeps its look; its menu sits beside it. */
  const withMenu = (card: ReactNode) => (menu ? <div className={cn("flex items-start gap-1", m.mine && "flex-row-reverse")}>{card}{menu}</div> : card);
  if (!m.deleted && (m.message_type === "birthday" || m.message_type === "anniversary")) return m.celebration ? withMenu(<Celebration m={m} onCelebrate={onCelebrate} onChange={onChange ?? (() => undefined)} onReload={onReload ?? (() => undefined)} />) : null;
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
