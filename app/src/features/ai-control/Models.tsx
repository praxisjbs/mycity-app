import aiControl from "@mycity/contract/schemas/ai_control.js";
import type { AiControlModel, AiPriceProposal, AiPricesSave, AiProvider } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { invalidate, refresh, useApi, usePaged } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { doesOf } from "@/features/settings/integrations/words";
import { useRouter } from "@/lib/router";
import { hrefFor } from "@/lib/routes";
import {
  ActionGroup,
  Button,
  DataView,
  DesktopOnly,
  Field,
  FilterSelect,
  Form,
  FormError,
  FormFooter,
  HelpTerm,
  KeyValue,
  Money,
  PageHeader,
  PhoneOnly,
  Pill,
  ProgressBar,
  TextField,
  toast,
  useContractForm,
  useModal,
} from "@mycity/ui";
import { useEffect, useState } from "react";
import { HELP, JOB, PROVIDER, SHOW, positionOf, reasonOf, usd } from "./words";

/** A refusal says why, and the screen reloads: a proposal decided or a search started meanwhile shows as it now is. */
const fail = (e: unknown, fallback: string) => {
  toast.error(e instanceof ApiError ? e.message : fallback);
  invalidate("/api/v1/ai-control");
};

type Priced = Pick<AiControlModel, "input_usd_per_million" | "output_usd_per_million" | "usd_per_audio_hour">;

/** What a model costs: per hour of audio for a speech model, else per million tokens in and out. */
function priceOf(m: Priced): string | null {
  if (m.usd_per_audio_hour) return `${usd(m.usd_per_audio_hour)} an hour`;
  const inp = usd(m.input_usd_per_million);
  const out = usd(m.output_usd_per_million);
  if (inp && out) return `${inp} / ${out} per M`;
  return inp ? `${inp} per M` : null;
}

/** The same in naira at the day's rate. */
function nairaOf(m: AiControlModel) {
  if (m.ngn_per_audio_hour) return <Money value={m.ngn_per_audio_hour} />;
  if (!m.input_ngn_per_million) return null;
  return (
    <span className="whitespace-nowrap">
      <Money value={m.input_ngn_per_million} />
      {m.output_ngn_per_million && (
        <>
          {" / "}
          <Money value={m.output_ngn_per_million} />
        </>
      )}
    </span>
  );
}

const chainsOf = (m: AiControlModel) =>
  m.in_chains.map((c) => `${c.scope === "job" ? JOB[c.key as keyof typeof JOB] : (c.label ?? c.key)}${c.position > 1 ? ` (${positionOf(c.position)})` : ""}`).join(", ") || null;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** While Find Prices runs, its state is read again this often. */
const FINDING_MS = 3000;

type Values = Record<keyof AiPricesSave, string>;
const PRICE_FIELDS: Array<[keyof AiPricesSave, string]> = [
  ["input_usd_per_million", "Input per Million"],
  ["output_usd_per_million", "Output per Million"],
  ["audio_usd_per_million", "Audio per Million"],
  ["usd_per_audio_hour", "Per Audio Hour"],
  ["usd_per_thousand_searches", "Per 1,000 Searches"],
];

/** A price as the field shows it: "0.3000" → "0.30". */
const trimmed = (v: string | null) => (v ? v.replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1") : "");

/**
 * Edit Price, and Accept with the proposal's prices to change first: dollars as the provider
 * publishes them; blank is no price.
 */
function PriceForm({ start, save, done, label }: { start: Priced & Partial<AiControlModel>; save: (body: AiPricesSave) => Promise<unknown>; done: () => void; label: string }) {
  const [problem, setProblem] = useState<string | null>(null);
  const f = useContractForm<Values>(
    {
      input_usd_per_million: trimmed(start.input_usd_per_million),
      output_usd_per_million: trimmed(start.output_usd_per_million),
      audio_usd_per_million: trimmed(start.audio_usd_per_million ?? null),
      usd_per_audio_hour: trimmed(start.usd_per_audio_hour),
      usd_per_thousand_searches: trimmed(start.usd_per_thousand_searches ?? null),
    },
    aiControl.AiPricesSave,
  );
  const submit = async () => {
    setProblem(null);
    try {
      await save(f.values);
      invalidate("/api/v1/ai-control");
      toast("Prices saved");
      done();
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err && Object.keys(err.fields).length) return f.setServerErrors(err.fields);
      setProblem(err?.message ?? "Not saved");
    }
  };
  return (
    <Form onSubmit={f.submit(submit)}>
      {PRICE_FIELDS.map(([k, text]) => (
        <Field key={k} label={text} optional {...f.status(k)}>
          <TextField {...f.field(k)} inputMode="decimal" placeholder="0.30" maxLength={14} />
        </Field>
      ))}
      {problem && <FormError>{problem}</FormError>}
      <FormFooter>
        <Button onClick={done}>Cancel</Button>
        <Button variant="primary" type="submit">
          {label}
        </Button>
      </FormFooter>
    </Form>
  );
}

/** One model in a sheet: its prices in dollars and naira, the chains it is in, Edit Price. */
function ModelSheet({ m, close }: { m: AiControlModel; close: () => void }) {
  const { can } = useAuth();
  const modal = useModal();
  const { navigate } = useRouter();
  const edit = () =>
    modal.open({
      title: "Edit Price",
      body: (done) => <PriceForm start={m} label="Save Prices" save={(body) => api.call("PUT /api/v1/ai-control/models/:id/prices", { params: { id: m.ai_model_id }, body })} done={done} />,
    });
  return (
    <>
      <KeyValue
        items={[
          ["Provider", PROVIDER[m.provider]],
          ["Model ID", <span data-copy="content">{m.model}</span>],
          ["Does", doesOf(m.capabilities)],
          ["On Key", m.available === true ? "Available" : m.available === false ? "Not on Key" : "Not Checked"],
          ["Plan", m.plan === "free" ? "Free" : m.plan === "paid" ? "Paid" : null],
          ["Price", priceOf(m) ?? (m.not_listed ? <HelpTerm help={HELP.notListed}>Not Listed</HelpTerm> : null)],
          [<HelpTerm help={HELP.naira}>In Naira</HelpTerm>, nairaOf(m)],
          ["Per 1,000 Searches", usd(m.usd_per_thousand_searches)],
          ["In Chains", chainsOf(m)],
        ]}
      />
      <FormFooter>
        {can("integrations", "view") && (
          <Button
            onClick={() => {
              close();
              navigate(hrefFor("settings", "integrations", { id: m.provider }));
            }}
          >
            Open Connection
          </Button>
        )}
        {can("ai_control", "edit") && (
          <Button variant="primary" icon="edit" onClick={edit}>
            Edit Price
          </Button>
        )}
      </FormFooter>
    </>
  );
}

/** The New Prices sheet (decision 31): the run as it goes, its proposals, Accept All, Find More. */
function NewPrices() {
  const { can } = useAuth();
  const edit = can("ai_control", "edit");
  const summary = useApi("GET /api/v1/ai-control/models/summary");
  const list = usePaged("GET /api/v1/ai-control/prices");
  const s = summary.data;
  const run = s?.run ?? null;
  const running = run?.status === "running";

  // While the run goes, its proposals are read again quietly; the tab behind polls the run itself.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => refresh("/api/v1/ai-control/prices"), FINDING_MS);
    return () => {
      clearInterval(t);
      invalidate("/api/v1/ai-control");
    };
  }, [running]);

  const accept = async (p: AiPriceProposal) => {
    try {
      await api.call("POST /api/v1/ai-control/prices/:id/accept", {
        params: { id: p.ai_price_proposal_id },
        body: {
          input_usd_per_million: p.input_usd_per_million ?? "",
          output_usd_per_million: p.output_usd_per_million ?? "",
          audio_usd_per_million: p.audio_usd_per_million ?? "",
          usd_per_audio_hour: p.usd_per_audio_hour ?? "",
          usd_per_thousand_searches: p.usd_per_thousand_searches ?? "",
        },
      });
      invalidate("/api/v1/ai-control");
      toast("Prices saved");
    } catch (e) {
      fail(e, "Not saved");
    }
  };
  const dismiss = async (p: AiPriceProposal) => {
    try {
      await api.call("POST /api/v1/ai-control/prices/:id/dismiss", { params: { id: p.ai_price_proposal_id }, body: {} });
      invalidate("/api/v1/ai-control");
      toast("Proposal dismissed");
    } catch (e) {
      fail(e, "Not dismissed");
    }
  };
  const acceptAll = async () => {
    try {
      const r = await api.call("POST /api/v1/ai-control/prices/accept-all", { body: {} });
      invalidate("/api/v1/ai-control");
      if (r.accepted === 0) toast.info("Nothing left to accept");
      else toast(`${r.accepted} ${r.accepted === 1 ? "price" : "prices"} saved`);
    } catch (e) {
      fail(e, "Not saved");
    }
  };
  const findMore = async () => {
    try {
      await api.call("POST /api/v1/ai-control/prices/find", { body: {} });
      toast("Finding prices");
      await refresh("/api/v1/ai-control/models/summary");
    } catch (e) {
      fail(e, "Not started");
    }
  };

  const waiting = list.page?.total ?? list.rows.length;
  const reason = run && run.status !== "running" ? reasonOf(run.error_code) : null;
  return (
    <>
      {running && (
        <ProgressBar
          className="mb-3"
          label={run.batches_total ? `Batch ${Math.min(run.batches_done + 1, run.batches_total)} of ${run.batches_total}` : "Starting Search"}
          value={run.batches_total ? run.batches_done : undefined}
          max={run.batches_total || 100}
        />
      )}
      {reason && (
        <div className="mb-3">
          <Pill tone={run?.status === "failed" ? "err" : "warn"}>{reason}</Pill>
        </div>
      )}
      <DataView<AiPriceProposal>
        list={list}
        caption="New prices"
        noun="price"
        rowKey={(r) => r.ai_price_proposal_id}
        empty={running ? { title: "Searching", icon: "srch" } : { title: "Nothing New", icon: "check" }}
        columns={[
          {
            key: "model",
            label: "Model",
            render: (r) => (
              <span className="flex min-w-0 flex-col">
                <span data-copy="content">{r.display_name}</span>
                <span className="text-xs text-subtle-foreground">{PROVIDER[r.provider]}</span>
              </span>
            ),
          },
          { key: "price", label: "Price", render: priceOf },
          { key: "page", label: "Page", desktop: true, render: (r) => <span data-copy="content">{hostOf(r.source_url)}</span> },
          {
            key: "do",
            label: "",
            render: (r) =>
              edit ? (
                <ActionGroup>
                  <Button size="sm" onClick={() => accept(r)}>
                    Accept
                  </Button>
                  <Button size="sm" onClick={() => dismiss(r)}>
                    Dismiss
                  </Button>
                </ActionGroup>
              ) : (
                <></>
              ),
          },
        ]}
      />
      {s && (
        <KeyValue
          className="mt-3"
          items={[
            ["Still to Price", String(s.to_price)],
            [<HelpTerm help={HELP.notListed}>Not Listed</HelpTerm>, String(s.not_listed)],
          ]}
        />
      )}
      {edit && !running && (waiting > 0 || (s?.to_price ?? 0) > 0) && (
        <FormFooter>
          {(s?.to_price ?? 0) > 0 && <Button onClick={findMore}>Find More</Button>}
          {waiting > 0 && (
            <Button variant="primary" icon="check" onClick={acceptAll}>
              Accept All
            </Button>
          )}
        </FormFooter>
      )}
    </>
  );
}

const PROVIDERS: Array<[AiProvider | "", string]> = [["", "Any Provider"], ...(Object.entries(PROVIDER) as Array<[AiProvider, string]>)];
type Show = (typeof SHOW)[number][0];

/** AI Control · Models (docs/guides/ai-control.md §2, §10). */
export function Models() {
  const { can } = useAuth();
  const modal = useModal();
  const [provider, setProvider] = useState<AiProvider | "">("");
  const [show, setShow] = useState<Show>("usable");
  const summary = useApi("GET /api/v1/ai-control/models/summary");
  const list = usePaged("GET /api/v1/ai-control/models", { filters: { ...(provider ? { provider } : {}), ...(show !== "usable" ? { show } : {}) } });
  const s = summary.data;
  const finding = !!s?.finding;

  // While a search runs, read its state again quietly until it ends, then the whole tab.
  const { reload } = summary;
  useEffect(() => {
    if (!finding) return;
    const t = setInterval(() => refresh("/api/v1/ai-control/models/summary"), FINDING_MS);
    return () => {
      clearInterval(t);
      invalidate("/api/v1/ai-control");
    };
  }, [finding]);

  const review = () => modal.open({ title: "New Prices", wide: true, full: true, body: () => <NewPrices /> });
  const find = async () => {
    try {
      await api.call("POST /api/v1/ai-control/prices/find", { body: {} });
      toast("Finding prices");
      await reload();
      review();
    } catch (e) {
      fail(e, "Not started");
    }
  };
  const waiting = finding || (s?.proposals ?? 0) > 0;
  // The last run's failure stays in view after New Prices is closed, for everyone who opens the tab.
  const failed = s?.run?.status === "failed" ? reasonOf(s.run.error_code) : null;
  const findButton = (
    <ActionGroup>
      {finding && (
        <Pill tone="info" className="phone:self-start">
          Finding Prices
        </Pill>
      )}
      {failed && (
        <Pill tone="err" className="phone:self-start">
          {failed}
        </Pill>
      )}
      {waiting && can("ai_control", "view") ? (
        <Button variant="primary" icon="check" onClick={review}>
          Review Prices
        </Button>
      ) : can("ai_control", "edit") ? (
        <Button variant="primary" icon="srch" onClick={find}>
          Find Prices
        </Button>
      ) : null}
    </ActionGroup>
  );

  return (
    <>
      <PageHeader
        title="Models"
        sub="Every provider's models and their prices"
        actions={<DesktopOnly className="flex items-center gap-2">{findButton}</DesktopOnly>}
      />
      <DataView<AiControlModel>
        list={list}
        title="Models"
        caption="AI models"
        noun="model"
        search="Search models"
        rowKey={(r) => r.ai_model_id}
        onRowClick={(m) => modal.open({ title: m.display_name, body: (close) => <ModelSheet m={m} close={close} /> })}
        actions={
          <>
            <FilterSelect label="Provider" value={provider} onChange={(v) => setProvider(v as AiProvider | "")} options={PROVIDERS} />
            <FilterSelect label="Show" value={show} onChange={(v) => setShow(v as Show)} options={SHOW} />
          </>
        }
        empty={{ title: "No Models", icon: "spark" }}
        columns={[
          {
            key: "name",
            label: "Model",
            render: (r) => (
              <span className="flex min-w-0 flex-col">
                <span data-copy="content" className="break-words">
                  {r.display_name}
                </span>
                <span className="text-xs text-subtle-foreground">
                  {PROVIDER[r.provider]}, {doesOf(r.capabilities)}
                </span>
              </span>
            ),
          },
          {
            key: "on_key",
            label: "On Key",
            render: (r) =>
              r.available === true ? <Pill tone="ok">Available</Pill> : r.available === false ? <Pill tone="neutral">Not on Key</Pill> : <Pill tone="warn">Not Checked</Pill>,
          },
          { key: "price", label: "Price", render: (r) => priceOf(r) ?? (r.proposed ? <Pill tone="info">Proposed</Pill> : r.not_listed ? <Pill tone="neutral">Not Listed</Pill> : null) },
          { key: "naira", label: <HelpTerm help={HELP.naira}>In Naira</HelpTerm>, desktop: true, render: nairaOf },
          { key: "chains", label: "In Chains", desktop: true, render: chainsOf },
        ]}
      />
      <PhoneOnly>
        <div className="mt-3 flex flex-col gap-2">{findButton}</div>
      </PhoneOnly>
    </>
  );
}
