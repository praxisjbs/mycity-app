import { useEffect, useMemo, useRef } from "react";
import appearance from "@mycity/contract/schemas/appearance.js";
import type { Appearance, AppearanceDarkSeeds, AppearancePatch } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { useFreshSignIn } from "@/auth/FreshSignIn";
import { KpiTiles } from "@/features/shared/KpiTiles";
import {
  Button,
  Card,
  CardHeader,
  Chips,
  ChoiceField,
  ColorField,
  Details,
  ErrorState,
  Field,
  fontStack,
  Form,
  FormFooter,
  Grid,
  LoadingRows,
  loadFont,
  PageHeader,
  SelectField,
  ThemePreview,
  toast,
  useContractForm,
} from "@mycity/ui";

/**
 * Settings · Appearance (docs/guides/foundation.md §6.15, §10): the hub's dark palette from four
 * pasted colours, with a live preview drawn from the contract's own maths (deriveDark, the same
 * the server saves with), its contrast, the two fonts, and the theme and density everyone starts
 * on. A change repaints the hub for everyone, so it confirms the person first (useFreshSignIn).
 * Holders of `settings` edit change it; anyone else who may open Settings sees it.
 */

type Seeds = AppearanceDarkSeeds;
const SEED_FIELDS: Array<{ key: keyof Seeds; label: string; help?: string }> = [
  { key: "background", label: "Background" },
  { key: "card", label: "Card" },
  { key: "brand_green", label: "Brand Green", help: "Links, highlights and the selected item's text." },
  { key: "primary_yellow", label: "Primary Yellow", help: "Buttons and the focus ring." },
];
const THEMES: Array<[Appearance["theme_default"], string]> = [
  ["system", "Follow the Device"],
  ["light", "Light"],
  ["dark", "Dark"],
];
const DENSITIES: Array<[Appearance["density_default"], string]> = [
  ["compact", "Compact"],
  ["comfortable", "Comfortable"],
];

/** "subtle-foreground" → "Subtle Foreground": a token as a person reads it. */
const tokenName = (token: string) => token.split("-").map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w)).join(" ");

const say = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Not saved. Try again.");

export function AppearanceTab() {
  const a = useApi("GET /api/v1/settings/appearance");
  const { can } = useAuth();
  const canEdit = can("settings", "edit");
  const d = a.data;
  return (
    <>
      <PageHeader title="Appearance" sub="Dark theme, fonts and defaults" />
      {a.error ? (
        <Card>
          <ErrorState error={a.error} onRetry={a.reload} />
        </Card>
      ) : !d ? (
        <Card>
          <LoadingRows count={6} />
        </Card>
      ) : (
        <Editor saved={d} canEdit={canEdit} />
      )}
    </>
  );
}

/** One change: confirmed first when the session needs it, then the hub repaints from the new /me. */
function useSave() {
  const save = useMutation("PATCH /api/v1/settings/appearance");
  const restore = useMutation("POST /api/v1/settings/appearance/restore");
  const fresh = useFreshSignIn();
  const { refreshMe } = useAuth();
  const done = async (message: string) => {
    invalidate("/api/v1/settings/appearance");
    await refreshMe();
    toast(message);
  };
  return {
    patch: async (body: AppearancePatch, message: string) => {
      const r = await fresh.guard(() => save.run({ body }));
      if (r) await done(message);
      return r;
    },
    restore: async () => {
      const r = await fresh.guard(() => restore.run({ body: {} }));
      if (r) await done("Previous palette restored");
    },
    pending: save.pending || restore.pending,
  };
}

function Editor({ saved, canEdit }: { saved: Appearance; canEdit: boolean }) {
  const s = useSave();
  const f = useContractForm<Seeds>(saved.dark.seeds, appearance.AppearanceDarkSeeds);
  /* Back to what is saved when the saved values change (after a save, a restore), never on a re-read of the same ones. */
  const savedSeeds = appearance.DARK_SEED_KEYS.map((k) => saved.dark.seeds[k]).join(" ");
  useEffect(() => f.reset(saved.dark.seeds), [savedSeeds]); // eslint-disable-line react-hooks/exhaustive-deps -- the saved palette, by value
  const fonts = useContractForm<{ heading: string; body: string }>(saved.fonts, appearance.AppearanceFonts);
  const savedFonts = `${saved.fonts.heading} ${saved.fonts.body}`;
  useEffect(() => fonts.reset(saved.fonts), [savedFonts]); // eslint-disable-line react-hooks/exhaustive-deps -- the saved fonts, by value

  /* The preview keeps the last palette that derives while a colour is half typed. */
  const derived = appearance.deriveDark(f.values);
  const good = useRef(derived);
  if (!Object.keys(derived.problems).length) good.current = derived;
  const shown = good.current;
  const preset = appearance.presetOf(f.values);

  const faces = useMemo(() => ({ heading: fontStack(fonts.values.heading), body: fontStack(fonts.values.body) }), [fonts.values.heading, fonts.values.body]);
  useEffect(() => {
    void loadFont(fonts.values.heading);
    void loadFont(fonts.values.body);
  }, [fonts.values.heading, fonts.values.body]);

  const savePalette = f.submit(async (seeds) => {
    try {
      await s.patch({ dark: seeds }, "Dark palette saved");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k.replace(/^dark\./, ""), v])));
      else say(e);
    }
  });
  const saveFonts = fonts.submit(async (next) => {
    try {
      await s.patch({ fonts: next as AppearancePatch["fonts"] }, "Fonts saved");
    } catch (e) {
      say(e);
    }
  });
  const setDefault = async (body: AppearancePatch, message: string) => {
    try {
      await s.patch(body, message);
    } catch (e) {
      say(e);
    }
  };

  const nudged = Object.entries(shown.nudged);
  const lowest = shown.pairs.reduce((m, p) => (p.ratio < m.ratio ? p : m), shown.pairs[0] ?? { text: "", surface: "", ratio: 0 });
  const presetChips = [
    ...saved.presets.map((p) => ({ value: p.key, label: p.name, disabled: !canEdit })),
    ...(preset ? [] : [{ value: "custom", label: "Custom", disabled: true }]),
  ];

  return (
    <>
      <Grid cols={2}>
        <Card>
          <CardHeader
            title="Dark Theme"
            help="The hub's dark theme, for everyone. The light theme stays MyCity's own."
            actions={
              canEdit && saved.previous ? (
                <Button size="sm" icon="rotate" onClick={() => s.restore()}>
                  Restore Previous
                </Button>
              ) : undefined
            }
          />
          <Chips
            label="Presets"
            value={preset ?? "custom"}
            onChange={(key) => {
              const p = saved.presets.find((x) => x.key === key);
              if (p) f.setValues(() => ({ ...p.seeds }));
            }}
            options={presetChips}
          />
          <Form onSubmit={savePalette}>
            {SEED_FIELDS.map((s2) => (
              <Field key={s2.key} label={s2.label} help={s2.help} {...f.status(s2.key)}>
                <ColorField {...f.field(s2.key)} disabled={!canEdit} />
              </Field>
            ))}
            {canEdit && (
              <FormFooter>
                <Button onClick={() => f.reset(saved.dark.seeds)}>Undo Changes</Button>
                <Button variant="primary" type="submit" busy={s.pending}>
                  Save Palette
                </Button>
              </FormFooter>
            )}
          </Form>
        </Card>
        <Card>
          <CardHeader title="Preview" />
          <ThemePreview label={`Preview, ${saved.presets.find((p) => p.key === preset)?.name ?? "Custom"}`} tokens={shown.tokens} faces={faces} />
        </Card>
      </Grid>
      <Card>
        <CardHeader title="Contrast" help="Text keeps 4.5 to 1 against what it sits on. A shade that fell short was adjusted." />
        <KpiTiles
          mobileCols={2}
          items={[
            { label: "Lowest Contrast", value: `${lowest.ratio.toFixed(2)}:1`, sub: tokenName(lowest.text), tone: "ok" },
            { label: "Pairs Checked", value: String(shown.pairs.length) },
            { label: "Adjusted", value: String(nudged.length), tone: nudged.length ? "warn" : undefined },
          ]}
        />
        {nudged.length > 0 && (
          <Details>
            {nudged.map(([token, from]) => (
              <div key={token} data-copy="content" className="flex justify-between gap-3 py-0.5 text-xs">
                <span>{tokenName(token)}</span>
                <span className="font-mono text-subtle-foreground">
                  {from} to {shown.tokens[token]}
                </span>
              </div>
            ))}
          </Details>
        )}
      </Card>
      <Grid cols={2}>
        <Card>
          <CardHeader title="Fonts" />
          <Form onSubmit={saveFonts}>
            <Field label="Heading Font" {...fonts.status("heading")}>
              <SelectField options={saved.font_options.map((o) => [o.id, o.name])} {...fonts.field("heading")} disabled={!canEdit} />
            </Field>
            <Field label="Body Font" {...fonts.status("body")}>
              <SelectField options={saved.font_options.map((o) => [o.id, o.name])} {...fonts.field("body")} disabled={!canEdit} />
            </Field>
            {canEdit && (
              <FormFooter>
                <Button onClick={() => fonts.reset(saved.fonts)}>Undo Changes</Button>
                <Button variant="primary" type="submit" busy={s.pending}>
                  Save Fonts
                </Button>
              </FormFooter>
            )}
          </Form>
        </Card>
        <Card>
          <CardHeader title="Defaults" help="For anyone who has not picked their own on this device." />
          <Field label="Theme for Everyone">
            <ChoiceField
              label="Theme for Everyone"
              options={THEMES}
              value={saved.theme_default}
              onChange={(v) => setDefault({ theme_default: v }, "Default theme saved")}
              disabled={canEdit ? undefined : THEMES.map(([v]) => v)}
            />
          </Field>
          <Field label="Density for Everyone">
            <ChoiceField
              label="Density for Everyone"
              options={DENSITIES}
              value={saved.density_default}
              onChange={(v) => setDefault({ density_default: v }, "Default density saved")}
              disabled={canEdit ? undefined : DENSITIES.map(([v]) => v)}
            />
          </Field>
        </Card>
      </Grid>
    </>
  );
}
