/**
 * Careers Settings (docs/guides/recruitment.md §6.1, §6.6): About MyCityApp, which the careers
 * page shows above every role, and the Default Traits a new vacancy's panel rates (MyCity's ten
 * from its Interview Assessment Format). Saved once for every role; a role already made keeps its own.
 */
import { useState } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import { Button, ErrorState, Field, FormError, FormFooter, LoadingRows, TextAreaField, TextField, toast } from "@mycity/ui";
import type { CareersSettings as Settings } from "@mycity/contract/contract.gen.ts";
import { say } from "./shared";

export function CareersSettings({ close, mayEdit }: { close: () => void; mayEdit: boolean }) {
  const read = useApi("GET /api/v1/recruitment/vacancies/settings");
  if (read.error) return <ErrorState error={read.error} onRetry={read.reload} />;
  if (!read.data) return <LoadingRows count={5} />;
  return <SettingsForm settings={read.data} close={close} mayEdit={mayEdit} />;
}

function SettingsForm({ settings, close, mayEdit }: { settings: Settings; close: () => void; mayEdit: boolean }) {
  const [about, setAbout] = useState(settings.about_company ?? "");
  const [traits, setTraits] = useState<string[]>(settings.default_traits);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation("PUT /api/v1/recruitment/vacancies/settings");
  const submit = async () => {
    setProblem(null);
    const kept = traits.map((t) => t.trim()).filter(Boolean);
    try {
      await save.run({ body: { about_company: about, default_traits: kept } });
      invalidate("/api/v1/recruitment/vacancies/settings");
      close();
      toast("Careers Settings saved");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) {
        const out: Record<string, string> = {};
        for (const [k, m] of Object.entries(e.fields)) out[k] = m[0] ?? "Check this";
        setErrors(out);
        setProblem(out.default_traits ?? null);
      } else say(e);
    }
  };
  const mark = (key: string) => (errors[key] ? { state: "bad" as const, message: errors[key] } : {});
  return (
    <>
      <Field label="About MyCityApp" optional {...mark("about_company")}>
        <TextAreaField value={about} onChange={setAbout} rows={5} disabled={!mayEdit} />
      </Field>
      {traits.map((t, i) => (
        <div key={i} className="mb-2 flex items-end gap-2">
          <Field label={`Default Trait ${i + 1}`} className="min-w-0 flex-1" {...mark(`default_traits.${i}`)}>
            <TextField value={t} onChange={(v) => setTraits((x) => x.map((y, k) => (k === i ? v : y)))} maxLength={120} disabled={!mayEdit} />
          </Field>
          {mayEdit && <Button size="sm" variant="ghost" icon="trash" onClick={() => setTraits((x) => x.filter((_, k) => k !== i))}>Remove</Button>}
        </div>
      ))}
      {mayEdit && traits.length < 20 && <Button size="sm" icon="plus" onClick={() => setTraits((x) => [...x, ""])}>Add Trait</Button>}
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>{mayEdit ? "Cancel" : "Close"}</Button>
        {mayEdit && <Button variant="primary" onClick={submit}>Save Settings</Button>}
      </FormFooter>
    </>
  );
}
