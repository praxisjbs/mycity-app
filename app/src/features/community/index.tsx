import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "@/api/client";
import { usePhoto, usePhotos } from "@/api/download";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useRealtime } from "@/api/realtime";
import "@/api/types/organisation";
import type { Announcement, Channel, Conversation, Member, Message } from "@/api/types/community";
import type { PersonRef } from "@/api/types/common";
import { useAuth } from "@/auth/AuthProvider";
import { useRouter, useSearchParams } from "@/lib/router";
import { useFitPage } from "@/shell/layout-context";
import type { ModuleScreenProps } from "@/shell/screens";
import { Composer, Row, ThreadBody, ThreadSearch, useThread } from "./Chat";
import { SendFiles, SharedFiles } from "./Media";
import { Avatar, Button, Card, ChoiceField, cn, DateField, EmptyState, ErrorState, Field, formatDate, formatDateTime, formatWhen, FormFooter, Grid, HelpTerm, Icon, IconButton, KeyValue, LoadingRows, Menu, Meter, PageHeader, Pill, rules, SearchInput, SplitPanes, StatStrip, Switch, TextAreaField, TextField, toast, todayIso, useContractForm, useConfirm, useIsMobile, useModal, useSplitPanes } from "@mycity/ui";
import { ColleaguePicker as EmployeePicker } from "@/features/shared/pickers";

export default function Community({ tab }: ModuleScreenProps) {
  if (tab === "direct-messages") return <Direct />;
  if (tab === "announcements") return <Announcements />;
  return <Channels />;
}

const Group = ({ children }: { children: ReactNode }) => <div className="px-2 pt-2 pb-1 text-2xs font-strong tracking-caps text-subtle-foreground uppercase">{children}</div>;

function ThreadHead({ children, onBack, backLabel }: { children: ReactNode; onBack: () => void; backLabel: string }) {
  return (
    <div className="flex flex-none items-center gap-2.5 border-b border-border py-2.5 pr-3 pl-4 max-md:px-2 max-md:py-2">
      <IconButton icon="left" label={backLabel} className="md:hidden" onClick={onBack} />
      {children}
    </div>
  );
}

const WHO_POSTS: Record<Channel["post_policy"], string> = { everyone: "Every member", admins: "Admins only", people_ceo: "People and the CEO" };

/** The departments, for whole-department chips. */
function DepartmentChips({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const departments = useApi("GET /api/v1/departments", { query: {} });
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Departments">
      {(departments.data?.data ?? []).map((d) => {
        const on = value.includes(d.department_id);
        return (
          <button key={d.department_id} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== d.department_id) : [...value, d.department_id])} className={cn("h-7 rounded-full border px-3 text-xs font-semibold phone:min-h-tap", on ? "border-secondary bg-secondary text-secondary-foreground" : "border-input bg-background text-muted-foreground hover:bg-muted")}>
            {d.name}
          </button>
        );
      })}
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
  const [drawer, setDrawer] = useState(false);
  const split = useSplitPanes("chat", 300);
  const rows = list.rows;
  const current = rows.find((c) => c.community_channel_id === sel) ?? (mobile ? undefined : rows.find((c) => c.can_post) ?? rows[0]);
  const reloadList = list.reload;
  const t = useThread(current?.community_channel_id ?? null, { onActivity: reloadList });
  /* Opening a channel marks it read, whether picked or shown first. */
  const openId = current?.community_channel_id;
  const openUnread = current?.unread ?? 0;
  useEffect(() => {
    if (openId && openUnread) void api.call("POST /api/v1/community/channels/:id/read", { params: { id: openId }, body: {} }).then(reloadList);
  }, [openId, openUnread, reloadList]);

  const pick = (c: Channel) => {
    setSel(c.community_channel_id);
    setOpen(true);
    setSearching(false);
    setDrawer(false);
  };
  const after = async (work: Promise<void>) => {
    await work;
    reloadList();
  };
  const pinned = rows.filter((c) => c.pinned);
  const rest = rows.filter((c) => !c.pinned);
  const row = (c: Channel) => (
    <Row
      key={c.community_channel_id}
      on={c.community_channel_id === current?.community_channel_id && (!mobile || open)}
      unread={c.unread > 0}
      lead={<span className={cn("flex size-7.5 flex-none items-center justify-center rounded-ctl border font-bold", c.community_channel_id === current?.community_channel_id ? "border-secondary bg-secondary text-secondary-foreground" : "border-border bg-muted text-muted-foreground")}>#</span>}
      title={<>{c.name}{!c.can_post && <Icon name="lock" className="size-3.5 text-subtle-foreground" />}</>}
      sub={c.last_text ?? `${c.members} ${c.members === 1 ? "member" : "members"}`}
      when={formatWhen(c.last_at)}
      count={c.unread}
      pinned={c.pinned && !c.pin_locked}
      muted={c.muted}
      onClick={() => pick(c)}
    />
  );

  const channelList = (
    <>
      {pinned.length > 0 && <><Group>Pinned</Group>{pinned.map(row)}</>}
      <Group>Channels</Group>
      {rest.length ? rest.map(row) : <p className="p-2 text-2xs text-subtle-foreground">No channel matches.</p>}
    </>
  );
  const listPane = (
    <>
      <div className="flex-none px-3 pt-3 pb-2"><SearchInput value={list.q} onChange={list.setQ} placeholder="Search channels" /></div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 max-md:overflow-visible">
        {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : list.loading && !rows.length ? <LoadingRows count={5} /> : channelList}
      </div>
    </>
  );

  const pinChannel = async (c: Channel) => {
    try {
      await api.call("PUT /api/v1/community/channels/:id/pin", { params: { id: c.community_channel_id }, body: { pinned: !c.pinned } });
      toast(c.pinned ? `Unpinned #${c.name}` : `Pinned #${c.name}`);
      reloadList();
    } catch (e) {
      if (e instanceof ApiError) toast(e.message);
    }
  };
  const muteChannel = async (c: Channel) => {
    await api.call("POST /api/v1/community/channels/:id/mute", { params: { id: c.community_channel_id }, body: { muted: !c.muted } });
    toast(c.muted ? `Notifications on for #${c.name}` : `#${c.name} muted`);
    reloadList();
  };

  const thread = current ? (
    <>
      <ThreadHead onBack={() => setOpen(false)} backLabel="Back to channels">
        {mobile && <IconButton icon="menu" label="Switch channel" onClick={() => setDrawer(true)} />}
        <span className="min-w-0 flex-1">
          <b className="flex items-center gap-1.5 truncate text-base font-strong"># {current.name}{!current.can_post && <Pill>Read Only</Pill>}</b>
          <span className="block truncate text-2xs text-subtle-foreground">
            {current.members} {current.members === 1 ? "member" : "members"}
            {!mobile && current.description && <> · {current.description}</>}
          </span>
        </span>
        <Menu
          trigger={(p) => <IconButton {...p} icon="dots" label="Channel menu" />}
          items={[
            { label: "View Members", icon: "users", onSelect: () => modal.open({ title: "Channel Members", body: (close) => <Members c={current} close={close} /> }) },
            ...(current.is_admin ? [{ label: "Edit Members", icon: "user" as const, onSelect: () => modal.open({ title: "Edit Members", body: (close) => <Members c={current} close={close} edit onChanged={reloadList} /> }) }] : []),
            { label: "Channel Details", icon: "info", onSelect: () => modal.open({ title: "Channel Details", body: (close) => <ChannelDetails c={current} close={close} onChanged={reloadList} /> }) },
            { label: "Search in Channel", icon: "srch", onSelect: () => setSearching(true) },
            "sep",
            ...(current.pin_locked ? [] : [{ label: current.pinned ? "Unpin" : "Pin to Top", icon: "pinned" as const, onSelect: () => void pinChannel(current) }]),
            { label: current.muted ? "Unmute Notifications" : "Mute Notifications", icon: current.muted ? ("bell" as const) : ("muted" as const), onSelect: () => void muteChannel(current) },
          ]}
        />
      </ThreadHead>
      {searching && <ThreadSearch t={t} onClose={() => setSearching(false)} />}
      <ThreadBody
        t={t}
        editPoll={(m) => modal.open({ title: "Edit Poll", body: (close) => <PollForm close={close} edit={m} send={(b) =>
              api
                .call("PUT /api/v1/community/messages/:id", { params: { id: m.community_message_id }, body: { body: b.body, options: b.options } })
                .then(t.replace)
                .catch((e: unknown) => {
                  if (e instanceof ApiError) toast(e.message);
                })
            } /> })}
      />
      {/* #announcements takes nothing posted straight in: no composer, for anyone. */}
      {current.post_policy !== "people_ceo" && (
      <Composer
        key={current.community_channel_id}
        placeholder={`Message #${current.name}`}
        readOnly={current.can_post ? undefined : "Only admins post here"}
        onSend={(b) => after(t.send(b))}
        onVoice={(file, secs) => after(t.sendFile(file, secs))}
        plus={(cls) => (
          <Menu
            align="start"
            trigger={(p) => <button {...p} type="button" className={cls} aria-label="Add to message"><Icon name="plus" /></button>}
            items={[
              { label: "Recognise a Colleague", icon: "thumb", onSelect: () => modal.open({ title: "Recognise a Colleague", body: (close) => <Recognise close={close} done={() => (t.reload(), reloadList())} /> }) },
              ...(current.can_moderate ? [{ label: "Celebrate", icon: "flag" as const, onSelect: () => modal.open({ title: "Celebrate", body: (close) => <Celebrate close={close} send={(b) => after(t.send(b))} /> }) }] : []),
              ...(current.can_poll ? [{ label: "Start a Poll", icon: "chart" as const, onSelect: () => modal.open({ title: "Start a Poll", body: (close) => <PollForm close={close} send={(b) => after(t.send(b))} /> }) }] : []),
              { label: "Attach a File", icon: "clip", onSelect: () => modal.open({ title: "Send Files", body: (close) => <SendFiles channelId={current.community_channel_id} close={close} send={(bs) => after(t.sendMany(bs))} /> }) },
            ]}
          />
        )}
      />
      )}
    </>
  ) : (
    <p className="m-auto text-xs text-subtle-foreground">Pick a channel.</p>
  );

  return (
    <>
      <PageHeader
        title="Channels"
        sub={list.page ? `${list.page.total} ${list.page.total === 1 ? "channel" : "channels"}` : " "}
        actions={<Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Channel", body: (close) => <NewChannel close={close} onMade={(c) => (list.reload(), pick(c))} /> })}>New Channel</Button>}
      />
      <SplitPanes split={split} list={listPane} detail={thread} open={open} />
      {drawer && <ChannelDrawer onClose={() => setDrawer(false)}>{channelList}</ChannelDrawer>}
    </>
  );
}

/** On a phone, inside a channel: the channel list as a side drawer (community.md §10.2). */
function ChannelDrawer({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const modal = useModal();
  useEffect(() => {
    /* Picking a channel unmounts the drawer without touching the sheet, so the sheet is closed
       here, unless it was the sheet that closed (the X, a drag), or another sheet could go too. */
    let shut = false;
    let leaving = false;
    modal.open({
      title: "Channels",
      body: () => <div className="-mx-2">{children}</div>,
      onClose: () => {
        shut = true;
        if (!leaving) onClose();
      },
    });
    return () => {
      leaving = true;
      if (!shut) modal.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opened once; the list inside is the live one
  }, []);
  return null;
}

function Members({ c, close, edit = false, onChanged }: { c: Channel; close: () => void; edit?: boolean; onChanged?: () => void }) {
  const list = usePaged("GET /api/v1/community/channels/:id/members", { params: { id: c.community_channel_id } });
  const [adding, setAdding] = useState(false);
  const remove = async (m: Member) => {
    await api.call("DELETE /api/v1/community/channels/:id/members/:user_id", { params: { id: c.community_channel_id, user_id: m.user_id } });
    toast(`Removed from #${c.name}`);
    list.reload();
    onChanged?.();
  };
  const setRole = async (m: Member, member_role: "admin" | "member") => {
    try {
      await api.call("PUT /api/v1/community/channels/:id/members/:user_id/role", { params: { id: c.community_channel_id, user_id: m.user_id }, body: { member_role } });
      toast(member_role === "admin" ? `${m.person.display_name} is now an admin` : `${m.person.display_name} is no longer an admin`);
      list.reload();
      onChanged?.();
    } catch (e) {
      if (e instanceof ApiError) toast(e.code === "LAST_ADMIN" ? "A channel needs an admin" : e.message);
    }
  };
  if (adding) return <AddMembers c={c} close={() => setAdding(false)} done={() => (setAdding(false), list.reload(), onChanged?.())} />;
  return (
    <>
      <SearchInput value={list.q} onChange={list.setQ} placeholder="Search members" className="mb-2" />
      <p data-copy="content" className="mb-2 text-2xs text-subtle-foreground">#{c.name} · {list.page?.total ?? c.members} members</p>
      <PeopleList
        people={list.rows.map((m) => m.person)}
        right={(p) => {
          const m = list.rows.find((x) => x.person.employee_id === p.employee_id)!;
          const admin = m.member_role === "admin";
          if (!edit) return admin ? <Pill tone="ok">Admin</Pill> : null;
          return (
            <span className="flex flex-none items-center gap-1.5">
              <Button size="sm" onClick={() => setRole(m, admin ? "member" : "admin")}>{admin ? "Remove Admin" : "Make Admin"}</Button>
              {!admin && <Button size="sm" onClick={() => remove(m)}>Remove</Button>}
            </span>
          );
        }}
      />
      {list.page?.has_next && <Button size="sm" className="mt-2" onClick={() => list.setPage(list.pageNumber + 1)}>Next Page</Button>}
      <FormFooter>
        {edit && <Button icon="plus" onClick={() => setAdding(true)}>Add People</Button>}
        <Button variant="primary" onClick={close}>Close</Button>
      </FormFooter>
    </>
  );
}

function AddMembers({ c, close, done }: { c: Channel; close: () => void; done: () => void }) {
  const [people, setPeople] = useState<PersonRef[]>([]);
  const [depts, setDepts] = useState<string[]>([]);
  const save = useMutation("POST /api/v1/community/channels/:id/members");
  const go = async () => {
    if (!people.length && !depts.length) return;
    await save.run({ params: { id: c.community_channel_id }, body: { member_ids: people.map((p) => p.employee_id), department_ids: depts } });
    toast(`Added to #${c.name}`);
    done();
  };
  return (
    <>
      <Field label="People" optional><EmployeePicker multiple value={people} onChange={setPeople} placeholder="Name or department" /></Field>
      <Field label="Departments" optional><DepartmentChips value={depts} onChange={setDepts} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} disabled={!people.length && !depts.length} onClick={go}>Add People</Button>
      </FormFooter>
    </>
  );
}

function PeopleList({ people, right }: { people: PersonRef[]; right?: (p: PersonRef) => ReactNode }) {
  const photo = usePhotos(people.map((p) => p.photo_url));
  return (
    <div className="max-h-64 overflow-y-auto rounded-box border border-border">
      {people.map((p) => (
        <div key={p.employee_id} className="flex items-center gap-2.5 border-b border-border px-2.5 py-2 last:border-b-0">
          <Avatar name={p.display_name} src={photo(p.photo_url)} size={30} />
          <span className="min-w-0 flex-1 text-sm"><b className="block truncate font-semibold">{p.display_name}</b><span className="text-2xs text-subtle-foreground">{p.department ?? p.job_title}</span></span>
          {right?.(p)}
        </div>
      ))}
      {!people.length && <p className="p-3 text-2xs text-subtle-foreground">Nobody here.</p>}
    </div>
  );
}

/** What a channel is; its admins rename it and write its purpose here. #general and #announcements stay fixed. */
function ChannelDetails({ c, close, onChanged }: { c: Channel; close: () => void; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const f = useContractForm({ name: c.name, purpose: c.description ?? "" }, { name: (v) => (/^[a-z0-9][a-z0-9-]{1,29}$/.test(v) ? null : "Not a valid name") });
  const save = useMutation("PUT /api/v1/community/channels/:id");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id: c.community_channel_id }, body: { name: f.values.name, description: f.values.purpose.trim() } });
      onChanged();
      close();
      toast("Channel saved");
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  if (editing)
    return (
      <>
        <Field label={<HelpTerm help="Lower case letters, numbers and hyphens, 2 to 30 characters. Two channels cannot share a name.">Channel Name</HelpTerm>} {...f.field("name")}><TextField {...f.field("name")} autoComplete="off" onChange={(v) => f.set("name", v.toLowerCase())} /></Field>
        <Field label="Purpose" optional><TextAreaField {...f.field("purpose")} /></Field>
        <FormFooter>
          <Button onClick={() => setEditing(false)}>Cancel</Button>
          <Button variant="primary" busy={save.pending} onClick={submit}>Save Changes</Button>
        </FormFooter>
      </>
    );
  return (
    <>
      <KeyValue items={[["Channel", `#${c.name}`], ["Purpose", c.description ?? "None"], ["Members", c.members], ["Who Can Post", WHO_POSTS[c.post_policy]]]} />
      <FormFooter>
        {c.is_admin && !c.pin_locked && <Button icon="edit" onClick={() => setEditing(true)}>Edit Channel</Button>}
        <Button variant="primary" onClick={close}>Close</Button>
      </FormFooter>
    </>
  );
}

function NewChannel({ close, onMade }: { close: () => void; onMade: (c: Channel) => void }) {
  const f = useContractForm({ name: "", purpose: "" }, { name: (v) => (/^[a-z0-9][a-z0-9-]{1,29}$/.test(v) ? null : "Not a valid name") });
  const [people, setPeople] = useState<PersonRef[]>([]);
  const [depts, setDepts] = useState<string[]>([]);
  const [who, setWho] = useState<"everyone" | "admins">("everyone");
  const save = useMutation("POST /api/v1/community/channels");
  const submit = async () => {
    if (!f.check()) return;
    try {
      const c = await save.run({ body: { name: f.values.name, description: f.values.purpose.trim() || undefined, member_ids: people.map((p) => p.employee_id), department_ids: depts, post_policy: who } });
      if (f.values.purpose.trim()) await api.call("POST /api/v1/community/channels/:id/messages", { params: { id: c.community_channel_id }, body: { message_type: "text", body: `Created #${c.name}: ${f.values.purpose.trim()}` } });
      close();
      onMade(c);
      toast(`#${c.name} created with ${c.members} members`);
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <Field label={<HelpTerm help="Lower case letters, numbers and hyphens, 2 to 30 characters. Two channels cannot share a name.">Channel Name</HelpTerm>} {...f.field("name")}><TextField {...f.field("name")} placeholder="abuja-hub" autoComplete="off" onChange={(v) => f.set("name", v.toLowerCase())} /></Field>
      <Field label="Purpose" optional><TextField {...f.field("purpose")} /></Field>
      <Field label="Departments" optional><DepartmentChips value={depts} onChange={setDepts} /></Field>
      <Field label={<>People <span className="font-normal text-subtle-foreground">· {people.length} selected</span></>} optional><EmployeePicker multiple value={people} onChange={setPeople} placeholder="Name or department" /></Field>
      <Field label="Who Can Post">
        <ChoiceField value={who} onChange={setWho} options={[["everyone", "Every Member"], ["admins", "Admins Only"]]} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Create Channel</Button>
      </FormFooter>
    </>
  );
}

/** A thumbs up for a colleague. It always lands in #general (MILESTONES A19). */
function Recognise({ close, done }: { close: () => void; done: () => void }) {
  const [who, setWho] = useState<PersonRef[]>([]);
  const [text, setText] = useState("");
  const [tried, setTried] = useState(false);
  const save = useMutation("POST /api/v1/community/recognitions");
  const go = async () => {
    setTried(true);
    if (!who.length) return;
    await save.run({ body: { to_employee_id: who[0].employee_id, message: text.trim() || undefined } });
    close();
    done();
    toast("Posted to #general");
  };
  return (
    <>
      <Field label="Colleague" state={tried && !who.length ? "bad" : undefined} message={tried && !who.length ? "Choose a colleague" : undefined}><EmployeePicker value={who} onChange={setWho} /></Field>
      <Field label={<HelpTerm help="Leave it blank and a thank you note is written for you.">Note</HelpTerm>} optional><TextAreaField value={text} onChange={setText} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon="thumb" busy={save.pending} onClick={go}>Post Recognition</Button>
      </FormFooter>
    </>
  );
}

function Celebrate({ close, send }: { close: () => void; send: (b: { message_type: "birthday" | "anniversary"; subject_employee_id: string }) => Promise<void> }) {
  const [who, setWho] = useState<PersonRef[]>([]);
  const [what, setWhat] = useState<"birthday" | "anniversary">("birthday");
  const [tried, setTried] = useState(false);
  const go = async () => {
    setTried(true);
    if (!who.length) return;
    close();
    await send({ message_type: what, subject_employee_id: who[0].employee_id });
  };
  return (
    <>
      <Field label="Colleague" state={tried && !who.length ? "bad" : undefined} message={tried && !who.length ? "Choose a colleague" : undefined}><EmployeePicker value={who} onChange={setWho} /></Field>
      <Field label="Occasion"><ChoiceField value={what} onChange={setWhat} options={[["birthday", "Birthday"], ["anniversary", "Work Anniversary"]]} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon="flag" onClick={go}>Post Celebration</Button>
      </FormFooter>
    </>
  );
}

/** Start a Poll, or with `edit` the same form filled in (before its first vote). */
function PollForm({ close, send, edit }: { close: () => void; send: (b: { message_type: "poll"; body: string; options: string[] }) => Promise<unknown>; edit?: Message }) {
  const opt = (i: number) => edit?.poll?.options[i]?.text ?? "";
  const f = useContractForm({ q: edit?.poll?.question ?? "", o1: opt(0), o2: opt(1), o3: opt(2), o4: opt(3) }, { q: (v) => (v.trim().length > 3 ? null : "Add a question"), o1: rules.required("Add an option"), o2: rules.required("Add an option") });
  const go = async () => {
    if (!f.check()) return;
    close();
    await send({ message_type: "poll", body: f.values.q.trim(), options: [f.values.o1, f.values.o2, f.values.o3, f.values.o4].map((o) => o.trim()).filter(Boolean) });
  };
  return (
    <>
      <Field label="Question" {...f.field("q")}><TextField {...f.field("q")} /></Field>
      {(["o1", "o2", "o3", "o4"] as const).map((k, i) => (
        <Field key={k} label={`Option ${i + 1}`} optional={i > 1} {...f.field(k)}><TextField {...f.field(k)} /></Field>
      ))}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon="chart" onClick={go}>{edit ? "Save Changes" : "Post Poll"}</Button>
      </FormFooter>
    </>
  );
}

/* ───────────────────────── Direct messages ───────────────────────── */

const seenLine = (c: { online: boolean; last_seen_at: string | null; is_self?: boolean }) => (c.is_self ? "Message yourself" : c.online ? "Online" : c.last_seen_at ? `Last seen ${formatWhen(c.last_seen_at)}` : "Offline");
/** A conversation's name: "You" for a conversation with oneself, as on WhatsApp. */
const chatName = (c: Conversation) => (c.is_self ? "You" : c.person.display_name);

function Direct() {
  const mobile = useIsMobile();
  useFitPage(!mobile);
  const modal = useModal();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const list = usePaged("GET /api/v1/community/direct", { filters: filter === "unread" ? { unread: true } : {} });
  const photo = usePhotos(list.rows.map((c) => c.person.photo_url));
  const [sel, setSel] = useState<Conversation | null>(null);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [info, setInfo] = useState(false);
  const split = useSplitPanes("chat", 300);
  const current = (sel && (list.rows.find((r) => r.community_channel_id === sel.community_channel_id) ?? sel)) ?? (mobile ? null : list.rows[0] ?? null);
  const reloadList = list.reload;
  const t = useThread(current?.community_channel_id ?? null, { direct: true, onActivity: reloadList });
  /* Reading a conversation clears its count on the server; show that in the list. */
  const openId = current?.community_channel_id;
  useEffect(() => {
    if (!openId) return;
    void api.call("POST /api/v1/community/channels/:id/read", { params: { id: openId }, body: {} }).then(reloadList, () => undefined);
  }, [openId, reloadList, t.msgs.length]);

  /* Messages that arrive while the list is open have reached this device. */
  const ackAll = useCallback(() => {
    for (const r of list.rows) if (r.unread > 0) void api.call("POST /api/v1/community/channels/:id/delivered", { params: { id: r.community_channel_id }, body: { up_to: new Date().toISOString() } }).catch(() => undefined);
  }, [list.rows]);
  useEffect(ackAll, [ackAll]);
  useRealtime("community.channels", reloadList);

  const pick = (c: Conversation) => {
    setSel(c);
    setOpen(true);
    setSearching(false);
  };
  const start = useCallback(
    async (p: PersonRef) => {
      try {
        const c = await api.call("POST /api/v1/community/direct", { body: { employee_id: p.employee_id } });
        reloadList();
        setSel(c);
        setOpen(true);
      } catch (e) {
        if (e instanceof ApiError) toast(e.message);
        else throw e;
      }
    },
    [reloadList],
  );
  /* The 360's "Message" button: /community?tab=direct-messages&to=<employee_id> */
  const to = params.get("to");
  useEffect(() => {
    if (!to) return;
    setParams({ to: null }, { replace: true });
    void api
      .call("POST /api/v1/community/direct", { body: { employee_id: to } })
      .then((c) => (setSel(c), setOpen(true), invalidate("/api/v1/community/direct")))
      .catch((e: unknown) => {
        if (e instanceof ApiError) toast(e.message);
      });
  }, [to, setParams]);

  const after = async (work: Promise<void>) => {
    await work;
    reloadList();
  };
  const pinConversation = async (c: Conversation) => {
    try {
      await api.call("PUT /api/v1/community/channels/:id/pin", { params: { id: c.community_channel_id }, body: { pinned: !c.pinned } });
      toast(c.pinned ? `Unpinned ${chatName(c)}` : `Pinned ${chatName(c)}`);
      reloadList();
    } catch (e) {
      if (e instanceof ApiError) toast(e.message);
    }
  };
  const mute = async (c: Conversation) => {
    await api.call("POST /api/v1/community/channels/:id/mute", { params: { id: c.community_channel_id }, body: { muted: !c.muted } });
    toast(c.muted ? `Notifications on for ${chatName(c)}` : `Muted ${chatName(c)}`);
    reloadList();
  };
  const showProfile = () => {
    if (!current) return;
    if (!mobile) return setInfo(true);
    modal.open({ title: "Profile", body: (close) => <ProfilePanel c={current} onMessage={close} onSearch={() => (close(), setSearching(true))} onMute={() => void mute(current)} /> });
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
            key={c.community_channel_id}
            on={c.community_channel_id === current?.community_channel_id && (!mobile || open)}
            unread={c.unread > 0}
            lead={<Avatar name={c.person.display_name} src={photo(c.person.photo_url)} size={32} online={c.online && !c.is_self} />}
            title={chatName(c)}
            sub={`${c.last_mine ? "You: " : ""}${c.last_text ?? "No messages yet"}`}
            when={formatWhen(c.last_at)}
            pinned={c.pinned}
            muted={c.muted}
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
          <Avatar name={current.person.display_name} src={photo(current.person.photo_url)} size={32} online={current.online && !current.is_self} />
          <span className="min-w-0 flex-1">
            <b className="block truncate text-base font-strong">{chatName(current)}</b>
            <span className="block truncate text-2xs text-subtle-foreground">{current.is_self ? seenLine(current) : `${seenLine(current)} · ${current.person.department}`}</span>
          </span>
        </button>
        <IconButton icon="srch" label="Search in conversation" onClick={() => setSearching(true)} />
        <Menu
          trigger={(p) => <IconButton {...p} icon="dots" label="Conversation menu" />}
          items={[
            { label: "View Profile", icon: "user", onSelect: showProfile },
            { label: "Search in Conversation", icon: "srch", onSelect: () => setSearching(true) },
            "sep",
            { label: current.pinned ? "Unpin" : "Pin to Top", icon: "pinned", onSelect: () => void pinConversation(current) },
            { label: current.muted ? "Unmute Notifications" : "Mute Notifications", icon: current.muted ? "bell" : "muted", onSelect: () => void mute(current) },
          ]}
        />
      </ThreadHead>
      {searching && <ThreadSearch t={t} onClose={() => setSearching(false)} />}
      <ThreadBody t={t} dm />
      <Composer
        key={current.community_channel_id}
        placeholder={current.is_self ? "Message yourself" : `Message ${current.person.display_name.split(" ")[0]}`}
        onSend={(b) => after(t.send(b))}
        onVoice={(file, secs) => after(t.sendFile(file, secs))}
        plus={(cls) => (
          <Menu
            align="start"
            trigger={(p) => <button {...p} type="button" className={cls} aria-label="Attach"><Icon name="clip" /></button>}
            items={[
              { label: "Photo or Video", icon: "image", onSelect: () => modal.open({ title: "Send Files", body: (close) => <SendFiles channelId={current.community_channel_id} accept="image/*,video/*" kinds="Photos or videos" close={close} send={(bs) => after(t.sendMany(bs))} /> }) },
              { label: "Document", icon: "doc", onSelect: () => modal.open({ title: "Send Files", body: (close) => <SendFiles channelId={current.community_channel_id} accept=".pdf,.docx,.xlsx,.pptx,.csv,.txt" kinds="PDF, Word, Excel or PowerPoint" close={close} send={(bs) => after(t.sendMany(bs))} /> }) },
            ]}
          />
        )}
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
        <ProfilePanel c={current} onMessage={() => document.querySelector<HTMLInputElement>('input[aria-label="Message"]')?.focus()} onSearch={() => setSearching(true)} onMute={() => void mute(current)} />
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
      <EmployeePicker value={who} onChange={setWho} placeholder="Name or department" withSelf />
      <FormFooter><Button onClick={close}>Cancel</Button></FormFooter>
    </>
  );
}

function ProfilePanel({ c, onMessage, onSearch, onMute }: { c: Conversation; onMessage: () => void; onSearch: () => void; onMute: () => void }) {
  const { navigate } = useRouter();
  const { can } = useAuth();
  const card = useApi("GET /api/v1/community/people/:id/card", { params: { id: c.person.employee_id } });
  const p = card.data;
  const photo = usePhoto(p?.person.photo_url ?? c.person.photo_url);
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
  const lagosNow = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  return (
    <div>
      <div className="border-b border-border pb-3.5 text-center">
        <Avatar name={p.person.display_name} src={photo} size="2xl" tone="brand" presence={p.online ? "online" : undefined} className="mx-auto mb-2.5 flex" />
        <h2 data-copy="content" className="text-lg font-semibold">{p.person.display_name}</h2>
        <p className="mt-0.5 text-2xs text-subtle-foreground">{p.person.job_title}</p>
        <p className="mt-1">{p.online ? <Pill tone="ok">Online</Pill> : <Pill>{seenLine(p)}</Pill>}</p>
        <div className="mt-3 flex justify-center gap-2">
          <Button icon="msg" onClick={onMessage}>Message</Button>
          {can("people") && <Button icon="user" onClick={() => navigate(`/people?tab=employees&id=${p.person.employee_id}`)}>View in People</Button>}
        </div>
      </div>
      <div className={sec}>
        <h3 data-ui="title" className={h4}>Contact</h3>
        {p.work_email && line("mail", p.work_email)}
        {p.phone && line("user", p.phone)}
        {p.worksite && line("globe", p.worksite)}
        {line("clock", `${lagosNow} in Lagos`)}
      </div>
      <div className={sec}>
        <h3 data-ui="title" className={h4}>Shared in Conversation</h3>
        <SharedFiles files={p.shared_files} />
        {p.voice_notes > 0 && line("mic", `${p.voice_notes} voice note${p.voice_notes > 1 ? "s" : ""}`)}
        {!p.shared_files.length && !p.voice_notes && <p className="text-2xs text-subtle-foreground">Nothing shared yet.</p>}
      </div>
      <div className={sec}>
        <h3 data-ui="title" className={h4}>Channels in Common</h3>
        {p.shared_channels.map((n) => <div key={n} className="flex items-center gap-2.5 py-1 text-sm"><b className="text-subtle-foreground">#</b>{n}</div>)}
      </div>
      <div className={sec}>
        <div className="flex items-center justify-between text-sm">Mute Notifications<Switch checked={c.muted} onChange={onMute} label="Mute Notifications" /></div>
        <Button icon="srch" className="mt-3 w-full justify-center" onClick={onSearch}>Search in Conversation</Button>
      </div>
    </div>
  );
}

/* ───────────────────────── Announcements ───────────────────────── */

function Announcements() {
  const modal = useModal();
  const list = usePaged("GET /api/v1/community/announcements");
  /* Counted on the server over every announcement, not from the page on screen. */
  const figures = useApi("GET /api/v1/community/announcements/stats");
  const f = figures.data;
  const stats = { pub: f?.published ?? 0, sch: f?.scheduled ?? 0, avg: f?.average_read ?? 0, audience: f?.audience ?? 0, month: f?.this_month ?? 0 };
  const denied = list.error instanceof ApiError && list.error.status === 403;
  if (denied) return <><PageHeader title="Announcements" /><EmptyState illustration="Locked" title="People and the CEO" text="Read them in #announcements." /></>;
  return (
    <>
      <PageHeader
        title="Announcements"
        actions={<Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Announcement", body: (close) => <NewAnnouncement close={close} done={list.reload} /> })}>New Announcement</Button>}
      />
      <StatStrip
        items={[
          { label: "Published", value: stats.pub },
          { label: "Scheduled", value: stats.sch },
          { label: "Average Read", value: `${stats.avg}%`, tone: "ok" },
          { label: "Audience", value: `${stats.audience} staff` },
          { label: "This Month", value: stats.month, desktop: true },
        ]}
      />
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : list.loading && !list.rows.length ? <Card><LoadingRows count={4} /></Card> : (
        <Grid cols={2} className="mt-3">
          {list.rows.map((a) => (
            <Card key={a.announcement_id} urgency={a.urgency} data-copy="content" role="button" tabIndex={0} className="cursor-pointer text-left transition hover:-translate-y-px hover:shadow-2" onClick={() => modal.open({ title: a.status === "scheduled" ? "Scheduled Announcement" : "Announcement Reads", body: (close) => <AnnouncementReads a={a} close={close} done={list.reload} /> })} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLElement).click()}>
              <div className="mb-1.5 flex items-start gap-2">
                <h2 data-copy="content" className="flex-1 text-sm font-semibold">{a.title}</h2>
                {a.status === "scheduled" ? <Pill tone="info">Scheduled</Pill> : <Pill tone={a.reads === a.audience_size ? "ok" : "neutral"}>{a.reads} of {a.audience_size} {a.urgency === "urgent" ? "acknowledged" : "read"}</Pill>}
              </div>
              <p className="line-clamp-3 text-sm whitespace-pre-wrap text-muted-foreground">{a.body}</p>
              <p className="mt-2 text-2xs text-subtle-foreground">{a.status === "scheduled" ? `Goes out ${formatDateTime(a.publish_at!)}` : `Posted ${formatDate(a.published_at!)}`} by {a.author?.display_name}</p>
            </Card>
          ))}
        </Grid>
      )}
    </>
  );
}

function AnnouncementReads({ a, close, done }: { a: Announcement; close: () => void; done: () => void }) {
  const live = a.status === "published";
  const [editing, setEditing] = useState(false);
  const confirm = useConfirm();
  const cancel = useMutation("POST /api/v1/community/announcements/:id/cancel");
  const callOff = async () => {
    if (!(await confirm({ title: "Cancel Announcement", body: `"${a.title}" will not be posted.`, confirmLabel: "Cancel Announcement", cancelLabel: "Keep It", destructive: true }))) return;
    try {
      await cancel.run({ params: { id: a.announcement_id }, body: {} });
      invalidate("/api/v1/community");
      close();
      done();
      toast("Announcement cancelled");
    } catch (e) {
      if (e instanceof ApiError) toast(e.message);
    }
  };
  /* A published one is taken down: it leaves #announcements and the tab, its reads kept for the record. */
  const archive = useMutation("POST /api/v1/community/announcements/:id/archive");
  const takeDown = async () => {
    if (!(await confirm({ title: "Archive Announcement", body: `"${a.title}" leaves #announcements for everyone.`, confirmLabel: "Archive Announcement", cancelLabel: "Keep It", destructive: true }))) return;
    try {
      await archive.run({ params: { id: a.announcement_id }, body: {} });
      invalidate("/api/v1/community");
      close();
      done();
      toast("Announcement archived");
    } catch (e) {
      if (e instanceof ApiError) toast(e.message);
    }
  };
  const notRead = usePaged("GET /api/v1/community/announcements/:id/reads", { params: { id: a.announcement_id }, filters: { read: "not_read" }, enabled: live });
  const read = usePaged("GET /api/v1/community/announcements/:id/reads", { params: { id: a.announcement_id }, filters: { read: "read" }, enabled: live });
  const remind = useMutation("POST /api/v1/community/announcements/:id/remind");
  const pct = Math.round((a.reads * 100) / Math.max(1, a.audience_size));
  const nNot = notRead.page?.total ?? 0;
  /* An urgent announcement is read once acknowledged (community.md §3 step 12). */
  const urgent = a.urgency === "urgent";
  const doneLabel = urgent ? "Acknowledged" : "Read";
  const notLabel = urgent ? "Not Acknowledged" : "Not Read";
  const ackAt = new Map(read.rows.map((r) => [r.person.employee_id, r.acknowledged_at]));
  const nudge = async () => {
    try {
      const r = await remind.run({ params: { id: a.announcement_id }, body: {} });
      toast(`Reminder sent to ${r.reminded} ${r.reminded === 1 ? "person" : "people"}`);
      done();
    } catch (e) {
      if (e instanceof ApiError) toast(e.message);
    }
  };
  if (editing) return <NewAnnouncement edit={a} close={() => setEditing(false)} done={() => (close(), done())} />;
  return (
    <>
      <div data-copy="content">
        <h4 className="text-md font-semibold">{a.title}</h4>
        <p className="mt-0.5 text-2xs text-subtle-foreground">{live ? `Posted ${formatDateTime(a.published_at!)}` : `Goes out ${formatDateTime(a.publish_at!)}`} by {a.author?.display_name}</p>
        <p className="mt-2.5 mb-3.5 text-sm whitespace-pre-wrap text-muted-foreground">{a.body}</p>
      </div>
      {!live ? <Pill tone="info">Scheduled</Pill> : (
        <>
          <h3 data-ui="title" className="mb-1.5 text-sm font-semibold">{doneLabel} by {a.reads} of {a.audience_size}</h3>
          <Meter pct={pct} label={`${pct}%`} />
          <div className="mt-4 mb-1.5 flex items-center gap-2">
            <h3 data-ui="title" className="flex-1 text-sm font-semibold">{notLabel} · {nNot}</h3>
            {nNot > 0 && <Button size="sm" icon="bell" busy={remind.pending} onClick={() => nudge()}>Remind Them</Button>}
          </div>
          {nNot ? <PeopleList people={notRead.rows.map((r) => r.person)} right={() => <Pill tone="err">{notLabel}</Pill>} /> : <p className="text-2xs text-subtle-foreground">{urgent ? "Everyone has acknowledged it." : "Everyone has read it."}</p>}
          <h3 data-ui="title" className="mt-4 mb-1.5 text-sm font-semibold">{doneLabel} · {read.page?.total ?? 0}</h3>
          <PeopleList
            people={read.rows.map((r) => r.person)}
            right={(p) => {
              const at = urgent ? ackAt.get(p.employee_id) : null;
              return <Pill tone="ok">{at ? formatDateTime(at) : doneLabel}</Pill>;
            }}
          />
        </>
      )}
      <FormFooter>
        {!live && <Button variant="danger" busy={cancel.pending} onClick={() => callOff()}>Cancel Announcement</Button>}
        {live && <Button variant="danger" icon="trash" busy={archive.pending} onClick={() => takeDown()}>Archive Announcement</Button>}
        {!live && <Button icon="edit" onClick={() => setEditing(true)}>Edit</Button>}
        <Button variant="primary" onClick={close}>Close</Button>
      </FormFooter>
    </>
  );
}

/** New Announcement, or with `edit` the same form filled in for a scheduled one. */
function NewAnnouncement({ close, done, edit }: { close: () => void; done: () => void; edit?: Announcement }) {
  const [when, setWhen] = useState<"now" | "later">(edit ? "later" : "now");
  const [kind, setKind] = useState<"all" | "departments">(edit?.audience.kind ?? "all");
  const [urgency, setUrgency] = useState<Announcement["urgency"]>(edit?.urgency ?? "normal");
  const [depts, setDepts] = useState<string[]>(edit?.audience.department_ids ?? []);
  const [deptsBad, setDeptsBad] = useState(false);
  const f = useContractForm({ title: edit?.title ?? "", body: edit?.body ?? "", date: edit?.publish_at ? todayIso(new Date(edit.publish_at)) : "" }, { title: (v) => (v.trim().length > 3 ? null : "Add a headline"), body: (v) => (v.trim().length > 3 ? null : "Write the message") });
  const save = useMutation("POST /api/v1/community/announcements");
  const change = useMutation("PUT /api/v1/community/announcements/:id");
  const submit = async () => {
    const noDate = when === "later" && !f.values.date;
    if (noDate) f.setServerErrors({ date: ["Not a real date"] });
    const noDepts = kind === "departments" && !depts.length;
    setDeptsBad(noDepts);
    if (!f.check() || noDate || noDepts) return;
    const audience = { kind, department_ids: kind === "departments" ? depts : [] };
    const publish_at = `${f.values.date}T09:00:00+01:00`;
    try {
      if (edit) {
        await change.run({ params: { id: edit.announcement_id }, body: { title: f.values.title.trim(), body: f.values.body.trim(), audience, urgency, publish_at } });
      } else {
        await save.run({ body: { title: f.values.title.trim(), body: f.values.body.trim(), audience, urgency, ...(when === "later" && { publish_at }) } });
      }
      invalidate("/api/v1/community");
      close();
      done();
      toast(edit ? `Scheduled for ${formatDate(f.values.date)}` : when === "later" ? `Scheduled for ${formatDate(f.values.date)}` : "Published to #announcements");
    } catch (e) {
      if (e instanceof ApiError && (e.status === 403 || e.status === 409)) toast(e.message);
      const fields = (edit ? change.fields : save.fields) ?? {};
      f.setServerErrors({ ...fields, ...(fields.publish_at ? { date: fields.publish_at } : {}) });
    }
  };
  return (
    <>
      <Field label="Headline" {...f.field("title")}><TextField {...f.field("title")} /></Field>
      <Field label="Message" {...f.field("body")}><TextAreaField {...f.field("body")} /></Field>
      <Field label="Level" help="Urgent stays red on everyone's screens and repeats every 30 minutes of the working day until each person acknowledges. Important reminds the unread after 4 hours.">
        <ChoiceField value={urgency} onChange={setUrgency} options={[["normal", "Normal"], ["important", "Important"], ["urgent", "Urgent"]]} />
      </Field>
      <Field label="Audience"><ChoiceField value={kind} onChange={setKind} options={[["all", "All Staff"], ["departments", "Departments"]]} /></Field>
      {kind === "departments" && (
        <Field label="Departments" state={deptsBad ? "bad" : undefined} message={deptsBad ? "Choose a department" : undefined}>
          <DepartmentChips value={depts} onChange={(v) => (setDepts(v), setDeptsBad(false))} />
        </Field>
      )}
      {!edit && <Field label="When"><ChoiceField value={when} onChange={setWhen} options={[["now", "Now"], ["later", "Schedule"]]} /></Field>}
      {when === "later" && <Field label="Publish Date" {...f.field("date")}><DateField {...f.field("date")} min={todayIso()} /></Field>}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending || change.pending} onClick={submit}>{edit ? "Save Changes" : when === "later" ? "Schedule Announcement" : "Publish Announcement"}</Button>
      </FormFooter>
    </>
  );
}
