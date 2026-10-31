import aiControl from "@mycity/contract/schemas/ai_control.js";
import type { AiActionRow, AiChain, AiChainSave, AiControlModel, AiJob, AiJobRow, ChainLink } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { invalidate, usePaged } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import {
  ActionGroup,
  Button,
  Card,
  CardHeader,
  DataView,
  DesktopOnly,
  ErrorState,
  Field,
  Form,
  FormError,
  FormFooter,
  formatTime,
  Grid,
  HelpTerm,
  LoadingRows,
  PageHeader,
  PhoneOnly,
  Pill,
  RecordPicker,
  TapList,
  toast,
  useContractForm,
  useModal,
} from "@mycity/ui";
import { useState } from "react";
import { HELP, JOB, JOB_HELP, NEEDS, PROVIDER, positionOf, SLOT_LABEL, SLOTS, STATE, type Slot } from "./words";

const fail = (e: unknown, fallback: string) => toast.error(e instanceof ApiError ? e.message : fallback);

/** Make First refused for one model ("Carries personal data") names that model: it has no form to mark. */
function firstFailed(e: unknown, chain: AiChain, position: number) {
  const at = e instanceof ApiError ? Object.entries(e.fields).find(([k]) => /^links\.\d+\.model$/.test(k)) : undefined;
  // The refused chain is the reordered one: the model moved first, then the rest in order.
  const moved = chain.links.find((l) => l.position === position);
  const reordered = moved ? [moved, ...chain.links.filter((l) => l !== moved)] : chain.links;
  const named = at && reordered[Number(at[0].split(".")[1])];
  if (at && named) toast.error(`${named.display_name}: ${at[1][0]}`);
  else fail(e, "Not moved");
}

/** A model's state as its pill reads; Skipped says until when. */
function StatePill({ link }: { link: ChainLink }) {
  const s = STATE[link.state];
  return <Pill tone={s.tone}>{link.state === "skipped" && link.until ? `Skipped Until ${formatTime(link.until)}` : s.text}</Pill>;
}

/** A chain, first to last: each model with its provider and state, and Make First on a fallback. */
function ChainList({ chain, onFirst }: { chain: AiChain; onFirst?: (position: number) => Promise<void> }) {
  return (
    <ActionGroup>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {chain.links.map((l) => (
          <li key={`${l.position}:${l.provider}:${l.model}`} className="flex min-w-0 items-center gap-2.5">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-xs text-subtle-foreground">{positionOf(l.position)}</span>
              <span data-copy="content" className="break-words text-sm font-medium">
                {l.display_name}
              </span>
              <span className="text-xs text-subtle-foreground">{PROVIDER[l.provider]}</span>
            </span>
            <StatePill link={l} />
            {onFirst && l.position > 1 && (
              <Button size="sm" icon="up" onClick={() => onFirst(l.position)}>
                Make First
              </Button>
            )}
          </li>
        ))}
      </ol>
    </ActionGroup>
  );
}

/** The first choice and its state: a job's line on a phone, an action's in the list. */
const firstOf = (chain: AiChain) => {
  const l = chain.links[0];
  return l ? (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <span data-copy="content">{l.display_name}</span>
      <StatePill link={l} />
    </span>
  ) : null;
};

/**
 * A job's or an action's chain in a sheet: Make First, Edit Chain, and for an action with its
 * own chain, Use Job Chain. `reopen` comes back here after Edit Chain.
 */
function ChainSheet({
  initial,
  job,
  action,
  locked,
  close,
  reopen,
}: {
  initial: AiChain;
  job: AiJob;
  action: AiActionRow | null;
  locked: boolean;
  close: () => void;
  reopen: (chain: AiChain) => void;
}) {
  const { can } = useAuth();
  const modal = useModal();
  const edit = can("ai_control", "edit") && !locked;
  const [chain, setChain] = useState(initial);
  // An action on its job's chain changes its own copy; the job's stays as it is.
  const scope = action ? "action" : "job";
  const key = action ? action.key : job;

  const first = async (position: number) => {
    try {
      setChain(await api.call("POST /api/v1/ai-control/chains/:scope/:key/first", { params: { scope, key }, body: { position } }));
      invalidate("/api/v1/ai-control");
      toast("Moved to first");
    } catch (e) {
      firstFailed(e, chain, position);
    }
  };
  const useJob = async () => {
    try {
      await api.call("DELETE /api/v1/ai-control/chains/action/:key", { params: { key } });
      invalidate("/api/v1/ai-control");
      toast(action?.set_chain ? "Back on its chosen chain" : "Back on its job's chain");
      close();
    } catch (e) {
      fail(e, "Not changed");
    }
  };
  const editChain = () =>
    modal.open({
      title: "Edit Chain",
      body: <EditChain scope={scope} chainKey={key} job={job} chain={chain} done={(c) => reopen(c ?? chain)} />,
    });

  return (
    <>
      {action && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Pill tone="info">{JOB[action.job]}</Pill>
          {action.personal_data && (
            <HelpTerm help={HELP.personalData}>
              <Pill tone="neutral">Personal Data</Pill>
            </HelpTerm>
          )}
          {action.own_chain && (
            <HelpTerm help={action.set_chain ? HELP.setChain : HELP.ownChain}>
              <Pill tone="neutral">Own Chain</Pill>
            </HelpTerm>
          )}
          {!action.built && <Pill tone="neutral">Not Built Yet</Pill>}
        </div>
      )}
      {locked && (
        <div className="mb-3">
          <Pill tone="warn">Locked</Pill>
        </div>
      )}
      <ChainList chain={chain} onFirst={edit ? first : undefined} />
      {edit && (
        <FormFooter>
          {action && chain.scope === "action" && chain.stored && <Button onClick={useJob}>{action.set_chain ? "Restore Chain" : "Use Job Chain"}</Button>}
          <Button variant="primary" icon="edit" onClick={editChain}>
            Edit Chain
          </Button>
        </FormFooter>
      )}
    </>
  );
}

type Opt = Pick<AiControlModel, "provider" | "model" | "display_name">;
type Values = Record<Slot, string>;
const keyOf = (o: Opt) => `${o.provider}:${o.model}`;

/** One place in the chain: a model the job can use, searched on the server, 25 at a time. */
function ModelPicker({ job, value, onChange }: { job: AiJob; value: Opt[]; onChange: (v: Opt[]) => void }) {
  const list = usePaged("GET /api/v1/ai-control/models", { filters: { capability: NEEDS[job] } });
  return (
    <RecordPicker<AiControlModel>
      list={{ rows: list.rows, page: list.page, loading: list.loading, error: list.error, q: list.q, setQ: list.setQ }}
      // A picked model reads by its name and id alone, whichever page it came from.
      value={value as AiControlModel[]}
      onChange={(rows) => onChange(rows.slice(-1).map((r) => ({ provider: r.provider, model: r.model, display_name: r.display_name })))}
      id={(r) => keyOf(r)}
      title={(r) => r.display_name}
      sub={(r) => `${PROVIDER[r.provider]}${r.available === false ? ", Not on Key" : ""}`}
      placeholder="Search models"
    />
  );
}

/**
 * Edit Chain: the first choice and up to three fallbacks, each a model the job can use. Embeddings
 * takes one (docs/guides/ai-control.md §6.6).
 */
function EditChain({
  scope,
  chainKey,
  job,
  chain,
  done,
}: {
  scope: "job" | "action";
  chainKey: string;
  job: AiJob;
  chain: AiChain;
  done: (chain?: AiChain) => void;
}) {
  const slots = job === "embeddings" ? SLOTS.slice(0, 1) : SLOTS;
  const [picked, setPicked] = useState<Record<Slot, Opt[]>>(() => {
    const out = { first: [], fallback1: [], fallback2: [], fallback3: [] } as Record<Slot, Opt[]>;
    chain.links.forEach((l, i) => {
      if (SLOTS[i]) out[SLOTS[i]] = [{ provider: l.provider, model: l.model, display_name: l.display_name }];
    });
    return out;
  });
  const [problem, setProblem] = useState<string | null>(null);
  const initial = Object.fromEntries(SLOTS.map((s) => [s, picked[s][0] ? keyOf(picked[s][0]) : ""])) as Values;

  /** The filled places in order, and which field each link came from. */
  const order = (v: Values) => slots.filter((s) => v[s]);
  const body = (v: Values): AiChainSave => ({
    links: order(v).map((s) => {
      const [provider, ...rest] = v[s].split(":");
      return { provider: provider as AiChainSave["links"][number]["provider"], model: rest.join(":") };
    }),
  });
  const f = useContractForm<Values>(initial, {
    safeParse: (v: Values) => {
      const r = aiControl.AiChainSave.safeParse(body(v));
      if (r.success) return r;
      const at = order(v);
      return { success: false, error: { issues: r.error.issues.map((i) => ({ ...i, path: [typeof i.path[1] === "number" ? (at[i.path[1]] ?? "first") : "first"] })) } };
    },
  });
  const pick = (s: Slot, v: Opt[]) => {
    setPicked((p) => ({ ...p, [s]: v }));
    f.field(s).onChange(v[0] ? keyOf(v[0]) : "");
  };

  const save = async () => {
    setProblem(null);
    try {
      const c = await api.call("PUT /api/v1/ai-control/chains/:scope/:key", { params: { scope, key: chainKey }, body: body(f.values) });
      invalidate("/api/v1/ai-control");
      toast("Chain saved");
      done(c);
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err && Object.keys(err.fields).length) {
        const at = order(f.values);
        const fields: Record<string, string[]> = {};
        for (const [k, msgs] of Object.entries(err.fields)) {
          const n = /^links\.(\d+)/.exec(k);
          fields[n ? (at[Number(n[1])] ?? "first") : "first"] = msgs;
        }
        return f.setServerErrors(fields);
      }
      setProblem(err?.message ?? "Not saved");
    }
  };

  return (
    <Form onSubmit={f.submit(save)}>
      {slots.map((s, i) => (
        <Field key={s} label={SLOT_LABEL[s]} optional={i > 0} {...f.status(s)}>
          <ModelPicker job={job} value={picked[s]} onChange={(v) => pick(s, v)} />
        </Field>
      ))}
      {problem && <FormError>{problem}</FormError>}
      <FormFooter>
        <Button onClick={() => done()}>Cancel</Button>
        <Button variant="primary" type="submit">
          Save Chain
        </Button>
      </FormFooter>
    </Form>
  );
}

/** One job on desktop: its chain in full, Make First on each fallback, Edit Chain. */
function JobCard({ row }: { row: AiJobRow }) {
  const { can } = useAuth();
  const modal = useModal();
  const edit = can("ai_control", "edit") && !row.locked;
  const first = async (position: number) => {
    try {
      await api.call("POST /api/v1/ai-control/chains/:scope/:key/first", { params: { scope: "job", key: row.job }, body: { position } });
      invalidate("/api/v1/ai-control");
      toast("Moved to first");
    } catch (e) {
      firstFailed(e, row.chain, position);
    }
  };
  const editChain = () =>
    modal.open({ title: "Edit Chain", body: (close) => <EditChain scope="job" chainKey={row.job} job={row.job} chain={row.chain} done={() => close()} /> });
  return (
    <Card>
      <CardHeader
        title={<HelpTerm help={JOB_HELP[row.job]}>{JOB[row.job]}</HelpTerm>}
        actions={
          row.locked ? (
            <Pill tone="warn">Locked</Pill>
          ) : edit ? (
            <Button size="sm" icon="edit" onClick={editChain}>
              Edit Chain
            </Button>
          ) : undefined
        }
      />
      <ChainList chain={row.chain} onFirst={edit ? first : undefined} />
    </Card>
  );
}

/** AI Control · Actions (docs/guides/ai-control.md §2, §10). */
export function Actions() {
  const modal = useModal();
  const jobs = usePaged("GET /api/v1/ai-control/jobs");
  const list = usePaged("GET /api/v1/ai-control/actions");

  const openChain = (chain: AiChain, job: AiJob, action: AiActionRow | null, locked: boolean) => {
    const show = (c: AiChain) =>
      modal.open({
        title: action ? action.label : JOB[job],
        body: (close) => <ChainSheet initial={c} job={job} action={action} locked={locked} close={close} reopen={show} />,
      });
    show(chain);
  };
  const openJob = (row: AiJobRow) => openChain(row.chain, row.job, null, row.locked);

  return (
    <>
      <PageHeader title="AI Control" sub="Which model answers each feature" />
      {jobs.error ? (
        <ErrorState error={jobs.error} onRetry={jobs.reload} />
      ) : !jobs.rows.length && jobs.loading ? (
        <LoadingRows count={4} />
      ) : (
        <>
          <DesktopOnly>
            <Grid cols={3}>
              {jobs.rows.map((row: AiJobRow) => (
                <JobCard key={row.job} row={row} />
              ))}
            </Grid>
          </DesktopOnly>
          <PhoneOnly>
            <Card pad={false}>
              <TapList
                label="Jobs"
                items={jobs.rows.map((row: AiJobRow) => ({ key: row.job, title: JOB[row.job], sub: firstOf(row.chain), onSelect: () => openJob(row) }))}
              />
            </Card>
          </PhoneOnly>
        </>
      )}
      <DataView<AiActionRow>
        className="mt-3"
        list={list}
        title="Actions"
        caption="AI actions"
        noun="action"
        search="Search actions"
        rowKey={(r) => r.key}
        onRowClick={(r) => openChain(r.chain, r.job, r, false)}
        empty={{ title: "No Actions", icon: "spark" }}
        columns={[
          {
            key: "action",
            label: "Action",
            render: (r) => (
              <span className="flex min-w-0 flex-col">
                <span data-copy="content">{r.label}</span>
                <span className="text-xs text-subtle-foreground">{JOB[r.job]}</span>
              </span>
            ),
          },
          { key: "first", label: "First Choice", render: (r) => firstOf(r.chain) },
          {
            key: "flags",
            label: "",
            desktop: true,
            render: (r) => (
              <span className="flex flex-wrap gap-1.5">
                {r.personal_data && <Pill tone="neutral">Personal Data</Pill>}
                {r.own_chain && <Pill tone="neutral">Own Chain</Pill>}
                {!r.built && <Pill tone="neutral">Not Built Yet</Pill>}
              </span>
            ),
          },
          { key: "calls", label: "Calls Today", align: "n", desktop: true, render: (r) => r.calls_today.toLocaleString("en-NG") },
        ]}
      />
    </>
  );
}
