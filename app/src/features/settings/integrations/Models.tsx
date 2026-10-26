import integrations from "@mycity/contract/schemas/integrations.js";
import type { AiModel, AiModelCreate, IntegrationCode } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { invalidate, usePaged } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import {
  Button,
  ChoiceField,
  DataView,
  Field,
  Form,
  FormError,
  FormFooter,
  IconButton,
  Pill,
  TextField,
  toast,
  useConfirm,
  useContractForm,
  useModal,
} from "@mycity/ui";
import { useState } from "react";
import { DOES, doesOf, JOB } from "./words";

/** A list price in dollars, as the provider writes it: "$0.30", "$0.075". */
function usd(price: string | null): string | null {
  if (!price) return null;
  const [whole = "0", frac = ""] = price.split(".");
  const cut = frac.replace(/0+$/, "");
  return `$${whole}.${cut.length < 2 ? cut.padEnd(2, "0") : cut}`;
}

/** What a model costs: per hour of audio for a speech model, else per million tokens in and out. */
function priceOf(m: AiModel): string | null {
  if (m.usd_per_audio_hour) return `${usd(m.usd_per_audio_hour)} an hour`;
  const inp = usd(m.input_usd_per_million);
  const out = usd(m.output_usd_per_million);
  if (inp && out) return `${inp} / ${out} per M`;
  return inp ? `${inp} per M` : null;
}

const ON_KEY = (m: AiModel) =>
  m.available === true ? <Pill tone="ok">Available</Pill> : m.available === false ? <Pill tone="neutral">Not on Key</Pill> : <Pill tone="warn">Not Checked</Pill>;

const inUseOf = (m: AiModel) => m.in_use.map((u) => `${JOB[u.job]}${u.position > 1 ? " (Fallback)" : ""}`).join(", ") || null;

/**
 * An AI connection's model list (docs/guides/integrations.md §1.2 decisions 2 and 3): seeded, read
 * from the provider whenever the key is saved or tested, and added to by hand. `reopen` goes back
 * to the connection after Add Model, which takes the panel's place.
 */
export function Models({ code, reopen }: { code: IntegrationCode; reopen: () => void }) {
  const { can } = useAuth();
  const modal = useModal();
  const confirm = useConfirm();
  const list = usePaged("GET /api/v1/integrations/:code/models", { params: { code } });

  const add = () => modal.open({ title: "Add Model", body: <AddModel code={code} done={reopen} /> });

  const remove = async (m: AiModel) => {
    if (!(await confirm({ title: "Remove Model", body: m.display_name, destructive: true }))) return;
    try {
      await api.call("DELETE /api/v1/integrations/:code/models/:id", { params: { code, id: m.ai_model_id } });
      toast("Model removed");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Not removed");
    } finally {
      invalidate("/api/v1/integrations");
    }
  };

  return (
    <DataView<AiModel>
      list={list}
      title="Models"
      caption="Models"
      noun="model"
      search="Search models"
      rowKey={(r) => r.ai_model_id}
      actions={
        can("integrations", "edit") ? (
          <Button size="sm" icon="plus" onClick={add}>
            Add Model
          </Button>
        ) : undefined
      }
      empty={{ title: "No Models", icon: "spark" }}
      columns={[
        {
          key: "name",
          label: "Model",
          render: (r) => {
            const used = inUseOf(r);
            return (
              <span className="flex min-w-0 flex-col">
                <span data-copy="content" className="break-words">
                  {r.display_name}
                </span>
                <span className="text-xs text-subtle-foreground">
                  {doesOf(r.capabilities)}
                  {used ? `, ${used}` : ""}
                </span>
              </span>
            );
          },
        },
        { key: "on_key", label: "On Key", render: ON_KEY },
        { key: "price", label: "Price", desktop: true, render: priceOf },
        // On a phone too (JBS Praxis, 26/10/2026): a model added by hand can be removed there.
        {
          key: "remove",
          label: "",
          render: (r) =>
            r.source === "added" && can("integrations", "delete") ? (
              <IconButton
                icon="trash"
                label={`Remove ${r.display_name}`}
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  return remove(r);
                }}
              />
            ) : (
              // Nothing to do for a seeded or listed model: an empty cell, not the empty-value mark.
              <></>
            ),
        },
      ]}
    />
  );
}

type Values = { model: string; display_name: string; does: string; endpoint_url: string };

/** What a provider's models mostly do: Add Model starts there. */
const STARTS: Partial<Record<IntegrationCode, string>> = { groq: "audio", openai: "embeddings", deepseek: "text", gemini: "multimodal" };

const DOES_OPTIONS: Array<[string, string]> = DOES.map((d) => [d.value, d.label]);

function AddModel({ code, done }: { code: IntegrationCode; done: () => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  const body = (v: Values): AiModelCreate => ({
    model: v.model,
    display_name: v.display_name,
    capabilities: DOES.find((d) => d.value === v.does)?.capabilities ?? ["text"],
    endpoint_url: v.endpoint_url,
  });
  const f = useContractForm<Values>(
    { model: "", display_name: "", does: STARTS[code] ?? "text_image", endpoint_url: "" },
    { safeParse: (v: Values) => integrations.AiModelCreate.safeParse(body(v)) },
  );
  const save = async () => {
    setProblem(null);
    try {
      await api.call("POST /api/v1/integrations/:code/models", { params: { code }, body: body(f.values) });
      invalidate("/api/v1/integrations");
      toast("Model added");
      done();
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err && Object.keys(err.fields).length) return f.setServerErrors(err.fields);
      setProblem(err?.message ?? "Not added");
    }
  };
  return (
    <Form onSubmit={f.submit(save)}>
      <Field label="Model ID" {...f.status("model")}>
        <TextField {...f.field("model")} placeholder="gemini-3.8-flash" maxLength={120} />
      </Field>
      <Field label="Name" optional {...f.status("display_name")}>
        <TextField {...f.field("display_name")} maxLength={120} />
      </Field>
      <Field label="Does" {...f.status("does")}>
        <ChoiceField {...f.field("does")} options={DOES_OPTIONS} />
      </Field>
      <Field label="Endpoint" optional {...f.status("endpoint_url")}>
        <TextField {...f.field("endpoint_url")} placeholder="https://" maxLength={300} />
      </Field>
      {problem && <FormError>{problem}</FormError>}
      <FormFooter>
        <Button onClick={done}>Cancel</Button>
        <Button variant="primary" type="submit">
          Add Model
        </Button>
      </FormFooter>
    </Form>
  );
}
