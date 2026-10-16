import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import "@/api/types/community";
import "@/api/types/organisation";
import type { Announcement, Channel, Conversation, MessageCreate } from "@/api/types/community";
import type { PersonRef } from "@/api/types/common";
import { useAuth } from "@/auth/AuthProvider";
import { useRouter, useSearchParams } from "@/lib/router";
import { useFitPage } from "@/shell/layout-context";
import type { ModuleScreenProps } from "@/shell/screens";
import { Composer, Row, ThreadBody, ThreadSearch, useThread } from "./Chat";
import { Avatar, Button, Card, ChoiceField, cn, DateField, ErrorState, Field, formatDate, formatDateTime, formatWhen, FormFooter, Grid, Icon, IconButton, KeyValue, LoadingRows, Menu, Meter, PageHeader, Pill, rules, SearchInput, SplitPanes, StatStrip, Switch, TextAreaField, TextField, toast, todayIso, UploadField, useContractForm, useIsMobile, useModal, useSplitPanes } from "@mycity/ui";
import { EmployeePicker } from "@/features/shared/pickers";
import { upload } from "@/api/upload";

export default function Community({ tab }: ModuleScreenProps) {
  if (tab === "direct-messages") return <Direct />;
  if (tab === "announcements") return <Announcements />;
  return <Channels />;
}

/** Modal footer row, inside the body so it can use the form's state. */

const Group = ({ children }: { children: ReactNode }) => <div className="px-2 pt-2 pb-1 text-2xs font-strong tracking-caps text-subtle-foreground uppercase">{children}</div>;

function ThreadHead({ children, onBack, backLabel }: { children: ReactNode; onBack: () => void; backLabel: string }) {
  return (
    <div className="flex flex-none items-center gap-2.5 border-b border-border py-2.5 pr-3 pl-4 max-md:px-2 max-md:py-2">
      <IconButton icon="left" label={backLabel} className="md:hidden" onClick={onBack} />
      {children}
    </div>
  );
}

/* ───────────────────────── Channels ───────────────────────── */

function Channels() {
  const mobile = useIsMobile();
  useFitPage(!mobile);
  const modal = useModal();
  const list = usePaged("GET /api/v1/community/channels");
  const [sel, setSel] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const split = useSplitPanes("chat", 300);
  const rows = list.rows;
  const current = rows.find((c) => c.channel_id === sel) ?? (mobile ? undefined : rows.find((c) => !c.read_only) ?? rows[0]);
  const t = useThread("channel", current?.channel_id ?? null);
  /* Opening a channel marks it read, whether picked or shown first. */
  const openId = current?.channel_id;
  const openUnread = current?.unread ?? 0;
  const reloadList = list.reload;
  useEffect(() => {
    if (openId && openUnread) void api.call("POST /api/v1/community/channels/:id/read", { params: { id: openId }, body: {} }).then(reloadList);
  }, [openId, openUnread, reloadList]);

  const pick = (c: Channel) => {
    setSel(c.channel_id);
    setOpen(true);
    setSearching(false);
  };
  const post = async (b: MessageCreate) => {
    await t.send(b);
    list.reload();
  };
  const pinned = rows.filter((c) => c.pinned);
  const rest = rows.filter((c) => !c.pinned);
  const row = (c: Channel) => (
    <Row
      key={c.channel_id}
      on={c.channel_id === current?.channel_id && (!mobile || open)}
      unread={c.unread > 0}
      lead={<span className={cn("flex size-7.5 flex-none items-center justify-center rounded-ctl border font-bold", c.channel_id === current?.channel_id ? "border-secondary bg-secondary text-secondary-foreground" : "border-border bg-muted text-muted-foreground")}>#</span>}
      title={<>{c.name}{c.read_only && <Icon name="lock" className="size-3.5 text-subtle-foreground" />}</>}
      sub={c.last_text ?? `${c.members} members`}
      when={formatWhen(c.last_at)}
      count={c.unread}
      onClick={() => pick(c)}
    />
  );

  const listPane = (
    <>
      <div className="flex-none px-3 pt-3 pb-2"><SearchInput value={list.q} onChange={list.setQ} placeholder="Search channels" /></div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 max-md:overflow-visible">
        {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : list.loading && !rows.length ? <LoadingRows count={5} /> : (
          <>
            {pinned.length > 0 && <><Group>Pinned</Group>{pinned.map(row)}</>}
            <Group>Channels</Group>
            {rest.length ? rest.map(row) : <p className="p-2 text-2xs text-subtle-foreground">No channel matches.</p>}
          </>
        )}
      </div>
    </>
  );

  const thread = current ? (
    <>
      <ThreadHead onBack={() => setOpen(false)} backLabel="Back to channels">
        <span className="min-w-0 flex-1">
          <b className="flex items-center gap-1.5 truncate text-base font-strong"># {current.name}{current.read_only && <Pill>Read Only</Pill>}</b>
          <span className="block text-2xs text-subtle-foreground">{current.members} members</span>
        </span>
        <Menu
          trigger={(p) => <IconButton {...p} icon="dots" label="Channel menu" />}
          items={[
            { label: "View Members", icon: "users", onSelect: () => modal.open({ title: `Members · #${current.name}`, body: (close) => <Members c={current} close={close} /> }) },
            { label: "Channel Details", icon: "info", onSelect: () => modal.open({ title: `#${current.name}`, body: (close) => <><KeyValue items={[["Members", current.members], ["Who can post", current.read_only ? "People and the CEO" : "Every member"], ["Visibility", "Internal to MyCity"]]} /><FormFooter><Button variant="primary" onClick={close}>Close</Button></FormFooter></> }) },
            { label: "Search in Channel", icon: "srch", onSelect: () => setSearching(true) },
            "sep",
            { label: "Mute Notifications", icon: "bell", onSelect: () => void api.call("POST /api/v1/community/channels/:id/mute", { params: { id: current.channel_id }, body: {} }).then(() => toast(`#${current.name} muted`)) },
          ]}
        />
      </ThreadHead>
      {searching && <ThreadSearch t={t} onClose={() => setSearching(false)} />}
      <ThreadBody t={t} />
      <Composer
        key={current.channel_id}
        placeholder={`Message #${current.name}`}
        readOnly={current.can_post ? undefined : "Only People and the CEO post here"}
        onSend={post}
        plus={(cls) => (
          <Menu
            align="start"
            trigger={(p) => <button {...p} type="button" className={cls} aria-label="Add to message"><Icon name="plus" /></button>}
            items={[
              { label: "Recognise a Colleague", icon: "thumb", onSelect: () => modal.open({ title: "Recognise a Colleague", body: (close) => <Recognise channel={current} close={close} done={t.reload} /> }) },
              { label: "Celebrate", icon: "flag", onSelect: () => modal.open({ title: "Celebrate", body: (close) => <Celebrate close={close} send={post} /> }) },
              { label: "Start a Poll", icon: "chart", onSelect: () => modal.open({ title: "Start a Poll", body: (close) => <PollForm close={close} send={post} /> }) },
              { label: "Attach a File", icon: "clip", onSelect: () => modal.open({ title: "Attach a File", body: (close) => <Attach close={close} send={post} /> }) },
            ]}
          />
        )}
      />
    </>
  ) : (
    <p className="m-auto text-xs text-subtle-foreground">Pick a channel.</p>
  );

  return (
    <>
      <PageHeader
        title="Channels"
        sub={list.page ? `${list.page.total} channels` : " "}
        actions={<Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Channel", body: (close) => <NewChannel close={close} onMade={(c) => (list.reload(), pick(c))} /> })}>New Channel</Button>}
      />
      <SplitPanes split={split} list={listPane} detail={thread} open={open} />
    </>
  );
}

function Members({ c, close }: { c: Channel; close: () => void }) {
  const list = usePaged("GET /api/v1/community/channels/:id/members", { params: { id: c.channel_id } });
  return (
    <>
      <SearchInput value={list.q} onChange={list.setQ} placeholder="Search members" className="mb-2" />
      <p className="mb-2 text-2xs text-subtle-foreground">{c.members} members{list.page && list.page.total > list.rows.length ? `, showing ${list.rows.length}` : ""}</p>
      <PeopleList people={list.rows} />
      {list.page?.has_next && <Button size="sm" className="mt-2" onClick={() => list.setPage(list.pageNumber + 1)}>Next Page</Button>}
      <FormFooter><Button variant="primary" onClick={close}>Close</Button></FormFooter>
    </>
  );
}

function PeopleList({ people, right }: { people: PersonRef[]; right?: (p: PersonRef) => ReactNode }) {
  return (
    <div className="max-h-64 overflow-y-auto rounded-box border border-border">
      {people.map((p) => (
        <div key={p.employee_id} className="flex items-center gap-2.5 border-b border-border px-2.5 py-2 last:border-b-0">
          <Avatar name={p.display_name} size={30} />
          <span className="min-w-0 flex-1 text-sm"><b className="block truncate font-semibold">{p.display_name}</b><span className="text-2xs text-subtle-foreground">{p.department ?? p.job_title}</span></span>
          {right?.(p)}
        </div>
      ))}
      {!people.length && <p className="p-3 text-2xs text-subtle-foreground">Nobody here.</p>}
    </div>
  );
}

function NewChannel({ close, onMade }: { close: () => void; onMade: (c: Channel) => void }) {
  const f = useContractForm({ name: "", purpose: "" }, { name: (v) => (/^[a-z0-9][a-z0-9-]{1,29}$/.test(v) ? null : "Lower case letters, numbers and hyphens, 2 to 30 characters") });
  const [people, setPeople] = useState<PersonRef[]>([]);
  const [depts, setDepts] = useState<string[]>([]);
  const [who, setWho] = useState<"everyone" | "admins">("everyone");
  const departments = useApi("GET /api/v1/departments", { query: {} });
  const save = useMutation("POST /api/v1/community/channels");
  const submit = async () => {
    if (!f.check()) return;
    try {
      const c = await save.run({ body: { name: f.values.name, member_ids: people.map((p) => p.employee_id), departments: depts, post_policy: who } });
      if (f.values.purpose.trim()) await api.call("POST /api/v1/community/channels/:id/messages", { params: { id: c.channel_id }, body: { kind: "text", text: `Created #${c.name}: ${f.values.purpose.trim()}` } });
      close();
      onMade(c);
      toast(`#${c.name} created with ${c.members} members`);
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <Field label="Channel Name" {...f.field("name")}><TextField {...f.field("name")} placeholder="e.g. abuja-hub" autoComplete="off" onChange={(v) => f.set("name", v.toLowerCase())} /></Field>
      <Field label="What Is It For"><TextField {...f.field("purpose")} placeholder="Optional" /></Field>
      <Field label="Add Whole Departments">
        <div className="flex flex-wrap gap-1.5">
          {(departments.data?.data ?? []).map((d) => {
            const on = depts.includes(d.name);
            return <button key={d.department_id} type="button" aria-pressed={on} onClick={() => setDepts(on ? depts.filter((x) => x !== d.name) : [...depts, d.name])} className={cn("h-7 rounded-full border px-3 text-xs font-semibold", on ? "border-secondary bg-secondary text-secondary-foreground" : "border-input bg-background text-muted-foreground hover:bg-muted")}>{d.name}</button>;
          })}
        </div>
      </Field>
      <Field label={<>Add People <span className="font-normal text-subtle-foreground">· {people.length} selected</span></>}><EmployeePicker multiple value={people} onChange={setPeople} placeholder="Name or department" /></Field>
      <Field label="Who Can Post" info="Set when the channel is created. Everyone can read.">
        <ChoiceField value={who} onChange={setWho} options={[["everyone", "Every Member"], ["admins", "Only Admins"]]} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Create Channel</Button>
      </FormFooter>
    </>
  );
}

function Recognise({ channel, close, done }: { channel: Channel; close: () => void; done: () => void }) {
  const [who, setWho] = useState<PersonRef[]>([]);
  const [text, setText] = useState("");
  const [tried, setTried] = useState(false);
  const save = useMutation("POST /api/v1/community/channels/:id/recognitions");
  const go = async () => {
    setTried(true);
    if (!who.length) return;
    await save.run({ params: { id: channel.channel_id }, body: { to_employee_id: who[0].employee_id, text: text.trim() || "Thank you for the great work this week." } });
    close();
    done();
    toast(`Posted to #${channel.name}`);
  };
  return (
    <>
      <Field label="Who" state={tried && !who.length ? "bad" : undefined} message={tried && !who.length ? "Choose who you are recognising" : undefined}><EmployeePicker value={who} onChange={setWho} /></Field>
      <Field label="What Did They Do (Optional)" info="Leave it blank and a note is written for you."><TextAreaField value={text} onChange={setText} placeholder="Led the launch" /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon="thumb" busy={save.pending} onClick={go}>Post</Button>
      </FormFooter>
    </>
  );
}

function Celebrate({ close, send }: { close: () => void; send: (b: MessageCreate) => Promise<void> }) {
  const [who, setWho] = useState<PersonRef[]>([]);
  const [what, setWhat] = useState<"birthday" | "anniversary">("birthday");
  const [tried, setTried] = useState(false);
  const go = async () => {
    setTried(true);
    if (!who.length) return;
    close();
    await send({ kind: what, subject_id: who[0].employee_id });
  };
  return (
    <>
      <Field label="Who" state={tried && !who.length ? "bad" : undefined} message={tried && !who.length ? "Choose who you are celebrating" : undefined}><EmployeePicker value={who} onChange={setWho} /></Field>
      <Field label="What"><ChoiceField value={what} onChange={setWhat} options={[["birthday", "Birthday"], ["anniversary", "Work Anniversary"]]} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon="flag" onClick={go}>Post</Button>
      </FormFooter>
    </>
  );
}

function PollForm({ close, send }: { close: () => void; send: (b: MessageCreate) => Promise<void> }) {
  const f = useContractForm({ q: "", o1: "", o2: "", o3: "", o4: "" }, { q: (v) => (v.trim().length > 3 ? null : "Ask a question"), o1: rules.required("At least two options"), o2: rules.required("At least two options") });
  const go = async () => {
    if (!f.check()) return;
    close();
    await send({ kind: "poll", poll: { question: f.values.q.trim(), options: [f.values.o1, f.values.o2, f.values.o3, f.values.o4].map((o) => o.trim()).filter(Boolean) } });
  };
  return (
    <>
      <Field label="Question" {...f.field("q")}><TextField {...f.field("q")} placeholder="Ask one question" /></Field>
      <Field label="Options" state={f.field("o1").state ?? f.field("o2").state} message={f.field("o1").message ?? f.field("o2").message}>
        <div className="flex flex-col gap-1.5">
          {(["o1", "o2", "o3", "o4"] as const).map((k, i) => <TextField key={k} {...f.field(k)} placeholder={`Option ${i + 1}${i > 1 ? " (optional)" : ""}`} aria-label={`Option ${i + 1}`} />)}
        </div>
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon="chart" onClick={go}>Post Poll</Button>
      </FormFooter>
    </>
  );
}

/** Files go to the vault through the upload engine, then into the conversation. */
function Attach({ close, send }: { close: () => void; send: (b: MessageCreate) => Promise<void> }) {
  return (
    <>
      <p className="mb-2.5 text-2xs text-subtle-foreground">Files are stored in the vault and shared here.</p>
      <UploadField
        upload={upload}
        purpose="community"
        multiple={false}
        onUploaded={(docs) => {
          close();
          void Promise.all(docs.map((d) => send({ kind: "file", document_id: d.document_id })));
        }}
      />
      <FormFooter><Button onClick={close}>Cancel</Button></FormFooter>
    </>
  );
}

/* ───────────────────────── Direct messages ───────────────────────── */

function Direct() {
  const mobile = useIsMobile();
  useFitPage(!mobile);
  const modal = useModal();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const list = usePaged("GET /api/v1/community/direct", { filters: filter === "unread" ? { unread: true } : {} });
  const [sel, setSel] = useState<Conversation | null>(null);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [info, setInfo] = useState(false);
  const split = useSplitPanes("chat", 300);
  const current = sel ?? (mobile ? null : list.rows[0] ?? null);
  const t = useThread("direct", current?.conversation_id ?? null);
  /* Reading a conversation clears its count on the server; show that in the list. */
  const openId = current?.conversation_id;
  const reloadList = list.reload;
  useEffect(() => {
    if (!openId) return;
    const x = setTimeout(reloadList, 500);
    return () => clearTimeout(x);
  }, [openId, reloadList]);

  const pick = (c: Conversation) => {
    setSel(c);
    setOpen(true);
    setSearching(false);
  };
  const start = async (p: PersonRef) => {
    const c = await api.call("POST /api/v1/community/direct", { body: { user_id: p.employee_id } });
    list.reload();
    pick(c);
  };
  /* The 360's "Message" button: /community?tab=direct-messages&to=<employee_id> */
  const to = params.get("to");
  useEffect(() => {
    if (!to) return;
    setParams({ to: null }, { replace: true });
    void api.call("POST /api/v1/community/direct", { body: { user_id: to } }).then((c) => (setSel(c), setOpen(true), invalidate("/api/v1/community/direct")));
  }, [to, setParams]);

  const post = async (b: MessageCreate) => {
    await t.send(b);
    list.reload();
  };
  const showProfile = () => {
    if (!current) return;
    if (!mobile) return setInfo(true);
    modal.open({ title: "Profile", body: (close) => <ProfilePanel c={current} onMessage={close} onSearch={() => (close(), setSearching(true))} /> });
  };
  const unread = list.rows.filter((r) => r.unread > 0).length;

  const listPane = (
    <>
      <div className="flex-none px-3 pt-3 pb-2"><SearchInput value={list.q} onChange={list.setQ} placeholder="Search people" label="Search conversations" /></div>
      <div className="flex flex-none gap-1 px-3 pb-2" role="group" aria-label="Show">
        {(["all", "unread"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={filter === v} onClick={() => setFilter(v)} className={cn("h-6.5 max-md:h-11 max-md:min-w-11 rounded-full px-2.5 text-2xs font-strong", filter === v ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted")}>{v === "all" ? "All" : "Unread"}</button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 max-md:overflow-visible">
        {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : list.loading && !list.rows.length ? <LoadingRows count={5} /> : list.rows.map((c) => (
          <Row
            key={c.conversation_id}
            on={c.conversation_id === current?.conversation_id && (!mobile || open)}
            unread={c.unread > 0}
            lead={<Avatar name={c.person.display_name} size={32} online={c.online} />}
            title={c.person.display_name}
            sub={`${c.last_mine ? "You: " : ""}${c.last_text ?? "No messages yet"}`}
            when={formatWhen(c.last_at)}
            count={c.unread}
            onClick={() => pick(c)}
          />
        ))}
        {!list.loading && !list.error && !list.rows.length && <p className="p-2.5 text-2xs text-subtle-foreground">Nothing here.</p>}
      </div>
    </>
  );

  const thread = current ? (
    <>
      <ThreadHead onBack={() => setOpen(false)} backLabel="Back to conversations">
        <button type="button" onClick={showProfile} className="flex min-w-0 flex-1 items-center gap-2.5 text-left" aria-label="View profile">
          <Avatar name={current.person.display_name} size={32} />
          <span className="min-w-0 flex-1">
            <b className="block truncate text-base font-strong">{current.person.display_name}</b>
            <span className="block truncate text-2xs text-subtle-foreground">{current.online ? "Online" : "Last seen yesterday"} · {current.person.department}</span>
          </span>
        </button>
        <IconButton icon="srch" label="Search in conversation" onClick={() => setSearching(true)} />
        <Menu
          trigger={(p) => <IconButton {...p} icon="dots" label="Conversation menu" />}
          items={[
            { label: "View Profile", icon: "user", onSelect: showProfile },
            { label: "Search in Conversation", icon: "srch", onSelect: () => setSearching(true) },
          ]}
        />
      </ThreadHead>
      {searching && <ThreadSearch t={t} onClose={() => setSearching(false)} />}
      <ThreadBody t={t} dm />
      <Composer
        key={current.conversation_id}
        voice
        placeholder={`Message ${current.person.display_name.split(" ")[0]}`}
        onSend={post}
        plus={(cls) => <button type="button" className={cls} aria-label="Attach" onClick={() => modal.open({ title: "Attach a File", body: (close) => <Attach close={close} send={post} /> })}><Icon name="clip" /></button>}
      />
    </>
  ) : (
    <p className="m-auto text-xs text-subtle-foreground">Pick a conversation.</p>
  );

  const side = info && !mobile && current ? (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-card border border-border bg-card shadow-1">
      <div className="flex flex-none items-center gap-2 border-b border-border py-2.5 pr-3 pl-4">
        <h3 data-ui="title" className="flex-1 text-sm font-semibold">Profile</h3>
        <IconButton icon="x" label="Close profile" onClick={() => setInfo(false)} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <ProfilePanel c={current} onMessage={() => document.querySelector<HTMLInputElement>('input[aria-label="Message"]')?.focus()} onSearch={() => setSearching(true)} />
      </div>
    </div>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Direct Messages"
        sub={unread ? `${unread} unread` : "All caught up"}
        actions={<Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Message", body: (close) => <NewMessage close={close} start={start} /> })}>New Message</Button>}
      />
      <SplitPanes split={split} list={listPane} detail={thread} aside={side} open={open} />
    </>
  );
}

function NewMessage({ close, start }: { close: () => void; start: (p: PersonRef) => Promise<void> }) {
  const [who, setWho] = useState<PersonRef[]>([]);
  useEffect(() => {
    if (!who.length) return;
    close();
    void start(who[0]);
  }, [who, close, start]);
  return (
    <>
      <EmployeePicker value={who} onChange={setWho} placeholder="Name or department" />
      <FormFooter><Button onClick={close}>Cancel</Button></FormFooter>
    </>
  );
}

function ProfilePanel({ c, onMessage, onSearch }: { c: Conversation; onMessage: () => void; onSearch: () => void }) {
  const { navigate } = useRouter();
  const { can } = useAuth();
  const card = useApi("GET /api/v1/community/people/:user_id/card", { params: { user_id: c.person.employee_id } });
  const [mute, setMute] = useState(false);
  const p = card.data;
  if (card.error) return <ErrorState error={card.error} onRetry={card.reload} />;
  if (!p) return <LoadingRows count={4} />;
  const sec = "border-b border-border py-3.5 last:border-b-0";
  const h4 = "mb-2 text-2xs font-strong tracking-caps text-subtle-foreground uppercase";
  const line = (icon: Parameters<typeof Icon>[0]["name"], text: ReactNode, right?: ReactNode) => (
    <div className="flex min-w-0 items-center gap-2.5 py-1 text-sm">
      <Icon name={icon} className="flex-none text-subtle-foreground" />
      <span className="min-w-0 truncate">{text}</span>
      {right && <span className="ml-auto flex-none text-2xs text-subtle-foreground">{right}</span>}
    </div>
  );
  return (
    <div>
      <div className="border-b border-border pb-3.5 text-center">
        <span className="relative mx-auto mb-2.5 flex size-18 items-center justify-center rounded-full bg-primary text-3xl font-bold text-primary-foreground">
          {p.person.display_name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
          {p.online && <i className="absolute right-0.5 bottom-0.5 size-3.5 rounded-full border-2 border-card bg-success" />}
        </span>
        <h2 data-copy="content" className="text-lg font-semibold">{p.person.display_name}</h2>
        <p className="mt-0.5 text-2xs text-subtle-foreground">{p.person.job_title}</p>
        <p className="mt-1">{p.online ? <Pill tone="ok">Online</Pill> : <Pill>Last seen yesterday</Pill>}</p>
        <div className="mt-3 flex justify-center gap-2">
          <Button icon="msg" onClick={onMessage}>Message</Button>
          {can("people") && <Button icon="user" onClick={() => navigate(`/people?tab=employees&id=${p.person.employee_id}`)}>View in People</Button>}
        </div>
      </div>
      <div className={sec}>
        <h3 data-ui="title" className={h4}>Contact</h3>
        {line("mail", p.email)}
        {p.phone && line("user", p.phone)}
        {line("globe", p.location)}
        {line("clock", `${p.local_time} in Lagos`)}
      </div>
      <div className={sec}>
        <h3 data-ui="title" className={h4}>Shared in this conversation</h3>
        {p.shared_files.length ? p.shared_files.map((f) => <div key={f.document_id}>{line("doc", f.file_name, f.size_bytes != null ? `${Math.round(f.size_bytes / 1024)} KB` : undefined)}</div>) : <p className="text-2xs text-subtle-foreground">Nothing shared yet.</p>}
      </div>
      <div className={sec}>
        <h3 data-ui="title" className={h4}>Channels in common</h3>
        {p.shared_channels.map((n) => <div key={n} className="flex items-center gap-2.5 py-1 text-sm"><b className="text-subtle-foreground">#</b>{n}</div>)}
      </div>
      <div className={sec}>
        <div className="flex items-center justify-between text-sm">Mute notifications<Switch checked={mute} onChange={(v) => (setMute(v), toast(v ? `Muted ${p.person.display_name}` : `Notifications on for ${p.person.display_name}`))} label="Mute notifications" /></div>
        <Button icon="srch" className="mt-3 w-full justify-center" onClick={onSearch}>Search in Conversation</Button>
      </div>
    </div>
  );
}

/* ───────────────────────── Announcements ───────────────────────── */

function Announcements() {
  const modal = useModal();
  const { can } = useAuth();
  const list = usePaged("GET /api/v1/community/announcements");
  const poster = can("people", "create");
  const stats = useMemo(() => {
    const pub = list.rows.filter((a) => !a.scheduled);
    const avg = pub.length ? Math.round((pub.reduce((s, a) => s + a.reads / Math.max(1, a.audience), 0) * 100) / pub.length) : 0;
    const month = todayIso().slice(0, 7);
    return { pub: pub.length, sch: list.rows.length - pub.length, avg, audience: list.rows[0]?.audience ?? 0, month: pub.filter((a) => a.publish_at.slice(0, 7) === month).length };
  }, [list.rows]);
  return (
    <>
      <PageHeader
        title="Announcements"
        sub="Posted by People and the CEO"
        actions={poster && <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Announcement", body: (close) => <NewAnnouncement close={close} /> })}>New Announcement</Button>}
      />
      <StatStrip items={[{ label: "Published", value: stats.pub }, { label: "Scheduled", value: stats.sch }, { label: "Average Read", value: `${stats.avg}%`, tone: "ok" }, { label: "Audience", value: `${stats.audience} staff` }, { label: "This Month", value: stats.month, desktop: true }]} />
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : list.loading && !list.rows.length ? <Card><LoadingRows count={4} /></Card> : (
        <Grid cols={2} className="mt-3">
          {list.rows.map((a) => (
            <Card key={a.announcement_id} data-copy="content" role="button" tabIndex={0} className="cursor-pointer text-left transition hover:-translate-y-px hover:shadow-2" onClick={() => modal.open({ title: a.title, body: (close) => <AnnouncementReads a={a} close={close} poster={poster} /> })} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLElement).click()}>
              <div className="mb-1.5 flex items-start gap-2">
                <h2 data-copy="content" className="flex-1 text-sm font-semibold">{a.title}</h2>
                {a.scheduled ? <Pill tone="info">Scheduled</Pill> : <Pill tone={a.reads === a.audience ? "ok" : "neutral"}>{a.reads} of {a.audience} read</Pill>}
              </div>
              <p className="text-sm text-muted-foreground">{a.body}</p>
              <p className="mt-2 text-2xs text-subtle-foreground">{a.scheduled ? "Goes out " : "Posted "}{a.scheduled ? formatDateTime(a.publish_at) : formatDate(a.publish_at)} by {a.author.display_name}</p>
            </Card>
          ))}
        </Grid>
      )}
    </>
  );
}

function AnnouncementReads({ a, close, poster }: { a: Announcement; close: () => void; poster: boolean }) {
  const notRead = usePaged("GET /api/v1/community/announcements/:id/reads", { params: { id: a.announcement_id }, filters: { read: "not_read" }, enabled: !a.scheduled && poster });
  const read = usePaged("GET /api/v1/community/announcements/:id/reads", { params: { id: a.announcement_id }, filters: { read: "read" }, enabled: !a.scheduled && poster });
  const remind = useMutation("POST /api/v1/community/announcements/:id/remind");
  const pct = Math.round((a.reads * 100) / Math.max(1, a.audience));
  const nNot = notRead.page?.total ?? 0;
  return (
    <>
      <p className="text-2xs text-subtle-foreground">{a.scheduled ? "Goes out " : "Posted "}{formatWhen(a.publish_at)} by {a.author.display_name}</p>
      <p className="mt-2.5 mb-3.5 text-sm text-muted-foreground">{a.body}</p>
      {a.scheduled ? <Pill tone="info">Scheduled. Not yet visible to staff</Pill> : poster && (
        <>
          <h3 data-ui="title" className="mb-1.5 text-sm font-semibold">Read by {a.reads} of {a.audience}</h3>
          <Meter pct={pct} label={`${pct}%`} />
          <div className="mt-4 mb-1.5 flex items-center gap-2">
            <h3 data-ui="title" className="flex-1 text-sm font-semibold">Not Read · {nNot}</h3>
            {nNot > 0 && <Button size="sm" icon="bell" busy={remind.pending} onClick={async () => { const r = await remind.run({ params: { id: a.announcement_id }, body: {} }); toast(`Reminder sent to ${r.reminded} ${r.reminded === 1 ? "person" : "people"}`); }}>Remind Them</Button>}
          </div>
          {nNot ? <PeopleList people={notRead.rows.map((r) => r.person)} right={() => <Pill tone="err">Not Read</Pill>} /> : <p className="text-2xs text-subtle-foreground">Everyone has read it.</p>}
          <h3 data-ui="title" className="mt-4 mb-1.5 text-sm font-semibold">Read · {read.page?.total ?? 0}</h3>
          <PeopleList people={read.rows.map((r) => r.person)} right={() => <Pill tone="ok">Read</Pill>} />
        </>
      )}
      <FormFooter><Button variant="primary" onClick={close}>Close</Button></FormFooter>
    </>
  );
}

function NewAnnouncement({ close }: { close: () => void }) {
  const { me } = useAuth();
  const [when, setWhen] = useState<"now" | "later">("now");
  const f = useContractForm({ title: "", body: "", date: "" }, { title: (v) => (v.trim().length > 3 ? null : "Give it a headline"), body: (v) => (v.trim().length > 3 ? null : "Write the message") });
  const save = useMutation("POST /api/v1/community/announcements");
  const submit = async () => {
    const noDate = when === "later" && !f.values.date;
    if (noDate) f.setServerErrors({ date: ["Pick the day it goes out"] });
    if (!f.check() || noDate) return;
    try {
      await save.run({ body: { title: f.values.title.trim(), body: f.values.body.trim(), ...(when === "later" && { publish_at: `${f.values.date}T09:00:00+01:00` }) } });
      invalidate("/api/v1/community");
      close();
      toast(when === "later" ? `Scheduled for ${formatDate(f.values.date)}` : "Published to #announcements");
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) toast(e.message);
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <Field label="Headline" {...f.field("title")}><TextField {...f.field("title")} placeholder="Office closed Friday" /></Field>
      <Field label="Message" {...f.field("body")}><TextAreaField {...f.field("body")} placeholder="Details for staff" /></Field>
      <Field label="When"><ChoiceField value={when} onChange={setWhen} options={[["now", "Now"], ["later", "Schedule"]]} /></Field>
      {when === "later" && <Field label="Date" {...f.field("date")}><DateField {...f.field("date")} min={todayIso()} /></Field>}
      <p className="flex items-center gap-1.5 text-2xs text-subtle-foreground"><Icon name="user" className="size-3.5" />Posting as {me?.display_name}</p>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>{when === "later" ? "Schedule" : "Publish"}</Button>
      </FormFooter>
    </>
  );
}
