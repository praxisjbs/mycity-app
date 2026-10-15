import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/api/client";
import type { Message } from "@/api/types/community";
import { cn, formatBytes, formatTime, Icon, initials, Avatar } from "@mycity/ui";

/** Highlight search hits inside a message. */
export function Hl({ text, q }: { text: string; q: string }) {
  if (!q.trim()) return <>{text}</>;
  const parts = text.split(new RegExp(`(${q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i} className="hit">{p}</mark> : p))}</>;
}

const CONFETTI = ["var(--primary)", "rgba(255,255,255,.85)", "var(--chart-2)", "var(--primary)", "var(--chart-4)"];

/** Birthday and work anniversary posts: the celebration card. */
function Celebration({ m, onCelebrate }: { m: Message; onCelebrate: () => void }) {
  const c = m.celebration!;
  const bday = m.kind === "birthday";
  const first = c.subject.display_name.split(" ")[0];
  const names = c.fans.slice(0, 2).map((f) => f.display_name.split(" ")[0]);
  const more = c.count - names.length;
  const who = c.count ? `${names.join(", ")}${more > 0 ? ` and ${more} other${more > 1 ? "s" : ""}` : ""} celebrated` : "Be the first to celebrate";
  return (
    <div
      className="sheen relative isolate flex max-w-[580px] animate-celeb-in items-center gap-4 overflow-hidden rounded-[18px] p-[18px] pb-4 text-on-deep max-md:gap-3 max-md:p-[14px]"
      style={{
        background: bday
          ? "radial-gradient(120% 140% at 100% 0%, rgba(255,223,85,.20), transparent 55%), linear-gradient(135deg, var(--secondary), var(--deep))"
          : "radial-gradient(120% 140% at 0% 100%, rgba(124,196,250,.22), transparent 55%), linear-gradient(135deg, var(--deep), var(--secondary))",
      }}
    >
      <span className={cn("confetti pointer-events-none absolute inset-0 -z-10 overflow-hidden", !bday && "stars")} aria-hidden="true">
        {Array.from({ length: 16 }, (_, i) => (
          <i key={i} style={{ left: `${(i * 6.3 + 3) % 100}%`, background: CONFETTI[i % 5], animationDuration: `${3.6 + ((i * 7) % 5) * 0.7}s`, animationDelay: `-${(i * 1.3) % 6}s` }} />
        ))}
      </span>
      <span className="relative flex-none">
        <span
          className="relative block size-[70px] animate-spin-slow rounded-full p-1 max-md:size-[58px]"
          style={{ background: bday ? "conic-gradient(var(--primary), rgba(255,223,85,.15), var(--primary), rgba(255,223,85,.15), var(--primary))" : "conic-gradient(var(--chart-2), rgba(124,196,250,.15), var(--primary), rgba(124,196,250,.15), var(--chart-2))" }}
        >
          <span className="flex size-full animate-spin-slow-reverse items-center justify-center rounded-full border-[3px] border-deep bg-primary text-[21px] font-[750] text-primary-foreground">{initials(c.subject.display_name)}</span>
        </span>
        <span className="absolute -right-1.5 -bottom-1 flex size-7 animate-bob items-center justify-center rounded-full bg-white text-[15px] shadow-[0_4px_10px_rgba(0,0,0,.25)]" aria-hidden="true">
          {bday ? "🎂" : "🏆"}
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-[9px] py-[3px] text-[10.5px] font-[750] tracking-[.12em] uppercase", bday ? "bg-primary text-primary-foreground" : "bg-chart-2 text-deep")}>
          {bday ? "Birthday" : "Work Anniversary"}
        </span>
        <h2 data-copy="content" className="mt-2 text-[18px] leading-tight tracking-[-.02em] max-md:text-[16px]">
          {bday ? <>Happy birthday, <em className="text-primary not-italic">{first}</em></> : <><em className="text-primary not-italic">{c.years} years</em> at MyCity, {first}</>}
        </h2>
        <p className="mt-[5px] text-[13px] text-on-deep-soft">{c.wish}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <button type="button" onClick={onCelebrate} className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-[11px] text-[12px] font-[650]", c.mine ? "border-primary bg-primary text-primary-foreground" : "border-white/20 bg-white/10 text-on-deep")}>
            {bday ? "🎉" : "👏"} Celebrate · {c.count}
          </button>
          {c.fans.length > 0 && (
            <span className="flex items-center">
              {c.fans.slice(0, 3).map((f, i) => (
                <span key={f.employee_id} className={cn("flex size-[22px] items-center justify-center rounded-full border-2 border-deep bg-accent text-[8.5px] font-bold text-accent-foreground", i > 0 && "-ml-1.5")}>{initials(f.display_name)}</span>
              ))}
            </span>
          )}
          <small className="text-[11.5px] text-on-deep-dim">{who}</small>
        </div>
      </div>
    </div>
  );
}

function VoiceNote({ m, mine }: { m: Message; mine: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [tr, setTr] = useState<"hidden" | "loading" | "shown">(m.voice?.transcript ? "hidden" : "hidden");
  const [text, setText] = useState(m.voice?.transcript ?? "");
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const secs = m.voice!.duration_s || 1;
  useEffect(() => () => void (t.current && clearTimeout(t.current)), []);
  const play = () => {
    if (playing) return (setPlaying(false), t.current && clearTimeout(t.current));
    setPlaying(true);
    t.current = setTimeout(() => setPlaying(false), secs * 1000);
  };
  const transcribe = async () => {
    if (tr === "shown") return setTr("hidden");
    if (text) return setTr("shown");
    setTr("loading");
    const r = await api.call("POST /api/v1/community/messages/:id/transcript", { params: { id: m.message_id }, body: {} });
    setText(r.transcript);
    setTr("shown");
  };
  return (
    <>
      <div className="flex min-w-[190px] items-center gap-[9px]">
        <button type="button" onClick={play} aria-label={playing ? "Pause voice note" : "Play voice note"} className={cn("flex size-[30px] flex-none items-center justify-center rounded-full bg-primary text-primary-foreground", playing && "shadow-[0_0_0_4px_rgba(255,223,85,.25)]")}>
          <Icon name={playing ? "pause" : "play"} />
        </button>
        <span className="flex h-6 flex-1 items-center gap-0.5">
          {Array.from({ length: 26 }, (_, b) => (
            <i key={b} className="w-[3px] rounded-sm bg-current transition-opacity" style={{ height: 5 + ((b * 37) % 17), opacity: playing ? 1 : 0.55, transitionDelay: playing ? `${(b * secs) / 26}s` : "0s", transitionDuration: playing ? `${secs / 26}s` : ".2s" }} />
          ))}
        </span>
        <em className="text-[11px] not-italic opacity-80">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</em>
      </div>
      {tr === "loading" && <p className="shimmer mt-2 max-w-[320px] rounded-[9px] px-2.5 py-2 text-[12.5px] leading-normal opacity-75">Transcribing…</p>}
      {tr === "shown" && <p className={cn("mt-2 max-w-[320px] rounded-[9px] px-2.5 py-2 text-[12.5px] leading-normal", mine ? "bg-white/10" : "bg-black/5")}>{text}</p>}
      <button type="button" onClick={transcribe} className="mt-[7px] inline-flex items-center gap-[5px] text-[11.5px] font-[650] underline underline-offset-2 opacity-85">
        {tr === "shown" ? "Hide Transcript" : <><Icon name="doc" className="size-[13px]" />Transcribe</>}
      </button>
    </>
  );
}

const TICK = { sent: ["tick", "Sent"], delivered: ["ticks", "Delivered"], read: ["ticks", "Read"] } as const;

/** One post in a channel or a conversation. */
export function Post({ m, q, dm, onCelebrate, onVote }: { m: Message; q: string; dm?: boolean; onCelebrate: () => void; onVote: (i: number) => void }) {
  if (m.kind === "birthday" || m.kind === "anniversary") return <Celebration m={m} onCelebrate={onCelebrate} />;
  if (m.kind === "recognition") {
    const r = m.recognition!;
    return (
      <div className="max-w-[560px] rounded-card border border-l-[3px] border-border border-l-primary bg-accent px-[14px] py-3">
        <div className="flex items-center gap-2 text-[13px]">
          <Avatar name={r.to.display_name} size={26} />
          <span><b>{m.author.display_name}</b> recognised <b>{r.to.display_name}</b></span>
        </div>
        <q className="mt-[7px] mb-[9px] block text-[13px] text-muted-foreground">{m.text}</q>
        <button type="button" onClick={onCelebrate} className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-[11px] text-[12px] font-[650]", r.mine ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted")}>👍 {r.count}</button>
      </div>
    );
  }
  if (m.kind === "poll") {
    const p = m.poll!;
    const votes = p.options.reduce((a, o) => a + o.votes, 0);
    const tot = votes || 1;
    return (
      <div className="max-w-[560px] rounded-card border border-border bg-background px-[14px] py-3">
        <div className="mb-[5px] text-[11.5px] text-subtle-foreground">Poll by {m.author.display_name} · {votes} vote{votes === 1 ? "" : "s"}</div>
        <h3 data-copy="content" className="mb-[9px] text-[13.5px]">{p.question}</h3>
        {p.options.map((o, i) => {
          const pc = Math.round((o.votes * 100) / tot);
          return (
            <button key={i} type="button" onClick={() => onVote(i)} aria-pressed={p.my_vote === i} className={cn("relative mb-1.5 block w-full overflow-hidden rounded-box border px-[11px] py-2 text-left text-[12.5px]", p.my_vote === i ? "border-secondary" : "border-border")}>
              <i className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${pc}%` }} />
              <span className={cn("relative flex justify-between gap-2", p.my_vote === i && "font-[650]")}><span>{o.text}</span><span>{pc}%</span></span>
            </button>
          );
        })}
      </div>
    );
  }
  if (m.kind === "announcement") {
    return (
      <div className="max-w-[620px] rounded-card border border-border bg-background px-[15px] py-[13px]">
        <div className="mb-1.5 flex items-center gap-2 text-[11.5px] text-subtle-foreground"><Icon name="flag" />{m.author.display_name} · {formatTime(m.created_at)}</div>
        <h3 data-copy="content" className="text-[14.5px]">{m.announcement!.title}</h3>
        <p className="mt-[5px] text-[13px] leading-normal text-muted-foreground">{m.announcement!.body}</p>
      </div>
    );
  }
  let inner: ReactNode;
  if (m.kind === "voice") inner = <VoiceNote m={m} mine={m.mine} />;
  else if (m.kind === "file")
    inner = (
      <div className={cn("mt-0.5 flex items-center gap-[9px] rounded-box border px-[11px] py-2", m.mine ? "border-white/20 bg-white/10" : "border-border bg-background")}>
        <Icon name="doc" />
        <span><b className="block text-[12.5px]">{m.file!.file_name}</b><span className="text-[11.5px] opacity-70">{formatBytes(m.file!.size_bytes)}</span></span>
      </div>
    );
  else inner = <Hl text={m.text ?? ""} q={q} />;
  return (
    <div className={cn("flex max-w-[82%] gap-[9px] max-md:max-w-[90%]", m.mine && "flex-row-reverse self-end")}>
      {!m.mine && <Avatar name={m.author.display_name} size={30} className="mt-0.5" />}
      <div className="min-w-0">
        <div className={cn("mb-[3px] flex items-baseline gap-[7px] text-[12px] font-[650]", m.mine && "justify-end")}>
          {!m.mine && m.author.display_name}
          <span className="text-[10.5px] font-normal text-subtle-foreground">
            {formatTime(m.created_at)}
            {m.mine && dm && m.status && (
              <span role="img" className={cn("ml-1 inline-flex align-[-3px]", m.status === "read" ? "text-info" : "text-subtle-foreground")} title={TICK[m.status][1]} aria-label={TICK[m.status][1]}>
                <Icon name={TICK[m.status][0]} className="size-[15px]" />
              </span>
            )}
          </span>
        </div>
        <div className={cn("px-3 py-2 text-[13px] leading-[1.45] [overflow-wrap:anywhere]", m.mine ? "rounded-[14px_4px_14px_14px] border border-secondary bg-secondary text-secondary-foreground" : "rounded-[4px_14px_14px_14px] border border-border bg-muted text-foreground")}>
          {inner}
        </div>
      </div>
    </div>
  );
}
