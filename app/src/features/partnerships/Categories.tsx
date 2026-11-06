import { useState } from "react";
import type { CategoryDetail, CategoryRow, CategoryTemplate, ChecklistItem, Field } from "@mycity/contract/contract.gen.ts";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useSearchParams } from "@/lib/router";
import { useScreenAction } from "@/shell/screen-action";
import {
  Button,
  Card,
  CardHeader,
  Chips,
  DataView,
  EmptyState,
  HelpTerm,
  IconButton,
  KeyValue,
  ListDetail,
  Menu,
  PageHeader,
  Pill,
  SegmentedControl,
  Skeleton,
  TapList,
  toast,
  useConfirm,
  useIsPhone,
  useModal,
  useSideBySide,
  Who,
} from "@mycity/ui";
import { CategoryForm } from "./forms/CategoryForm";
import { ChecklistForm } from "./forms/ChecklistForm";
import { FieldForm } from "./forms/FieldForm";
import { StartFromTracker } from "./forms/StartFromTracker";
import { TemplateEditor } from "./forms/TemplateEditor";
import { PipelineSettings } from "./PipelineSettings";
import { ProofPoints } from "./ProofPoints";
import { APPLIES_LABEL, dueText, FIELD_TYPE_LABEL, KIND_LABEL, refusal, useConfigure } from "./lib";

/**
 * Partnerships · Categories (#104, `categories`; docs/guides/partnerships.md §6.3, §10): MyCity's partnership
 * types and the setup the rest of the module reads. A category opens beside the list on desktop and in a sheet
 * on a phone (F31), with its defaults, its agreement templates, its delivery checklist and its custom fields;
 * Pipeline Settings holds MyCity's stages and lists, and Proof Points the facts a proposal may cite. Holders of
 * `partnerships.configure` add, change, retire and restore; everyone who may open Partnerships reads.
 */

type View = "categories" | "settings" | "proof";
type Shown = "true" | "false" | "all";
type Section = "defaults" | "templates" | "checklist" | "fields";

const VIEWS: Array<[View, string]> = [
  ["categories", "Categories"],
  ["settings", "Pipeline Settings"],
  ["proof", "Proof Points"],
];

const SECTIONS: Array<[Section, string]> = [
  ["defaults", "Defaults"],
  ["templates", "Templates"],
  ["checklist", "Checklist"],
  ["fields", "Fields"],
];

export function Categories() {
  const configure = useConfigure();
  const phone = useIsPhone();
  const modal = useModal();
  const [view, setView] = useState<View>("categories");
  const add = () => modal.open({ title: "New Category", body: (close) => <CategoryForm close={close} /> });
  const tracker = () => modal.open({ title: "Start From Tracker", wide: true, body: (close) => <StartFromTracker close={close} /> });
  useScreenAction(configure ? { label: "New Category", onSelect: add } : null);
  const sheet = (title: string, body: React.ReactNode) => modal.open({ title, full: true, body: () => body });

  return (
    <>
      <PageHeader
        title="Categories"
        sub="Partnership types and lists"
        actions={
          configure && (
            <>
              <Button icon="sheet" onClick={tracker}>
                Start From Tracker
              </Button>
              <Button variant="primary" icon="plus" onClick={add}>
                New Category
              </Button>
            </>
          )
        }
      />
      {!phone && (
        <div className="mb-3">
          <SegmentedControl label="Categories view" value={view} onChange={(v) => setView(v as View)} options={VIEWS} />
        </div>
      )}
      {(phone || view === "categories") && <CategoryList />}
      {phone && (
        <TapList
          label="More setup"
          items={[
            { key: "settings", title: "Pipeline Settings", onSelect: () => sheet("Pipeline Settings", <PipelineSettings />) },
            { key: "proof", title: "Proof Points", onSelect: () => sheet("Proof Points", <ProofPoints />) },
          ]}
        />
      )}
      {!phone && view === "settings" && <PipelineSettings />}
      {!phone && view === "proof" && <ProofPoints />}
    </>
  );
}

/** The categories, and the one picked (or opened by `?id=`) beside them or in a sheet. */
function CategoryList() {
  const [params] = useSearchParams();
  const beside = useSideBySide();
  const [shown, setShown] = useState<Shown>("true");
  const list = usePaged("GET /api/v1/partnerships/categories", { filters: shown === "all" ? {} : { active: shown }, sort: "display_order" });
  const [picked, setPicked] = useState<string | null>(null);
  const [closedLink, setClosedLink] = useState(false);
  const linked = params.get("id");
  const pinned = picked ?? (!closedLink ? linked : null);
  // Side by side the first category shows unasked; on a phone nothing opens until a row is tapped (F31).
  const sel = pinned ?? (beside ? (list.rows[0]?.partner_category_id ?? null) : null);
  const close = () => (setPicked(null), setClosedLink(true));

  return (
    <ListDetail
      open={pinned !== null}
      onClose={close}
      title="Category"
      list={
        <>
          <Chips
            label="Status"
            value={shown}
            onChange={(v) => setShown(v as Shown)}
            options={[
              ["true", "In Use"],
              ["false", "Retired"],
              ["all", "All"],
            ]}
          />
          <DataView
            title="All Categories"
            list={list}
            search="Category"
            rowKey={(c: CategoryRow) => c.partner_category_id}
            selectedKey={sel}
            onRowClick={(c) => setPicked(c.partner_category_id)}
            noun="category"
            nounPlural="categories"
            empty={{ icon: "pin", title: "No Categories Yet", text: "Add a type or start from the tracker." }}
            columns={[
              { key: "name", label: "Category", sortable: true, render: (c: CategoryRow) => <Who name={c.name} sub={c.active ? undefined : "Retired"} /> },
              { key: "p", label: "Partners", align: "n", render: (c: CategoryRow) => c.partners },
              { key: "l", label: "Leads", align: "n", desktop: true, render: (c: CategoryRow) => c.leads },
              { key: "c", label: "Commission", align: "n", render: (c: CategoryRow) => (c.default_commission_pct ? `${Number(c.default_commission_pct)}%` : null) },
            ]}
          />
        </>
      }
      detail={
        sel ? (
          <CategoryRecord key={sel} id={sel} onGone={close} />
        ) : (
          <Card>
            <p className="text-xs text-subtle-foreground">Select a category to see its setup.</p>
          </Card>
        )
      }
    />
  );
}

/** One category: its defaults, templates, checklist and fields, as cards on desktop and one at a time on a phone. */
function CategoryRecord({ id }: { id: string; onGone: () => void }) {
  const configure = useConfigure();
  const phone = useIsPhone();
  const modal = useModal();
  const confirm = useConfirm();
  const [section, setSection] = useState<Section>("defaults");
  const read = useApi("GET /api/v1/partnerships/categories/:id", { params: { id } });
  const change = useMutation("PATCH /api/v1/partnerships/categories/:id");
  const d = read.data;
  if (!d) return read.error ? <Card><p className="text-xs text-subtle-foreground">This category could not be loaded.</p></Card> : <Skeleton shape="block" className="h-48" />;

  const reload = () => invalidate("/api/v1/partnerships/categories");
  const setActive = async (active: boolean) => {
    if (!active && !(await confirm({ title: "Retire Category", body: `${d.name} leaves the pickers until it is restored.`, confirmLabel: "Retire Category", destructive: true }))) return;
    try {
      await change.run({ params: { id }, body: { active } });
      reload();
      toast(active ? "Category restored" : "Category retired");
    } catch (e) {
      toast(refusal(e, "Not saved. Try again."));
    }
  };
  const edit = () => modal.open({ title: "Edit Category", body: (close) => <CategoryForm category={d} close={close} /> });

  const cards: Record<Section, React.ReactNode> = {
    defaults: <DefaultsCard d={d} edit={configure ? edit : undefined} />,
    templates: <TemplatesCard d={d} configure={configure} />,
    checklist: <ChecklistCard d={d} configure={configure} />,
    fields: <FieldsCard d={d} configure={configure} />,
  };

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader
          title={d.name}
          record
          level={2}
          actions={
            <span className="flex items-center gap-1.5">
              {!d.active && <Pill>Retired</Pill>}
              {configure && (
                <Menu
                  label="Category actions"
                  trigger={(t) => <IconButton {...t} icon="dots" label="More Actions" />}
                  items={[
                    { label: "Edit", icon: "edit", onSelect: edit },
                    d.active
                      ? { label: "Retire", icon: "x", danger: true, onSelect: () => setActive(false) }
                      : { label: "Restore", icon: "refresh", onSelect: () => setActive(true) },
                  ]}
                />
              )}
            </span>
          }
        />
        {d.description && <p className="text-sm" data-copy="content">{d.description}</p>}
      </Card>
      {phone ? (
        <>
          <SegmentedControl label="Category sections" value={section} onChange={(v) => setSection(v as Section)} options={SECTIONS} />
          {cards[section]}
        </>
      ) : (
        SECTIONS.map(([key]) => <div key={key}>{cards[key]}</div>)
      )}
    </div>
  );
}

function DefaultsCard({ d, edit }: { d: CategoryDetail; edit?: () => void }) {
  return (
    <Card>
      <CardHeader title="Defaults" actions={edit ? <Button size="sm" icon="edit" onClick={edit}>Edit</Button> : undefined} />
      <KeyValue
        items={[
          ["Default Commission", d.default_commission_pct ? `${Number(d.default_commission_pct)}%` : null],
          ["Default Validity", d.default_validity_days ? `${d.default_validity_days} days` : null],
          [<HelpTerm key="v" help="Analytics counts leads in this category as vendor leads.">Counts as Vendor</HelpTerm>, d.counts_as_vendor ? "Yes" : "No"],
          ["Partners", d.counts.partners],
          ["Leads", d.counts.leads],
          ["Open Deals", d.counts.open_deals],
        ]}
      />
    </Card>
  );
}

function TemplatesCard({ d, configure }: { d: CategoryDetail; configure: boolean }) {
  const modal = useModal();
  const change = useMutation("PATCH /api/v1/partnerships/category-templates/:id");
  const open = (template?: CategoryTemplate, tidy = false) =>
    modal.open({ title: template ? "Edit Template" : "Add Template", wide: true, full: true, body: (close) => <TemplateEditor category={d} template={template} tidy={tidy} close={close} /> });
  const patch = async (t: CategoryTemplate, body: { is_default?: boolean; active?: boolean }, done: string) => {
    try {
      await change.run({ params: { id: t.partner_category_template_id }, body });
      invalidate("/api/v1/partnerships/categories");
      toast(done);
    } catch (e) {
      toast(refusal(e, "Not saved. Try again."));
    }
  };
  return (
    <Card>
      <CardHeader
        title="Templates"
        actions={
          configure ? (
            <span className="flex gap-1.5">
              <Button size="sm" icon="spark" onClick={() => open(undefined, true)}>
                Tidy With AI
              </Button>
              <Button size="sm" icon="plus" onClick={() => open()}>
                Add Template
              </Button>
            </span>
          ) : undefined
        }
      />
      {d.templates.length === 0 ? (
        <EmptyState bare title="No Templates Yet" text={configure ? "Add the agreements this type signs." : undefined} />
      ) : (
        <ul className="divide-y divide-border">
          {d.templates.map((t) => (
            <li key={t.partner_category_template_id} className="flex min-h-row items-center gap-2 py-1.5 phone:min-h-tap">
              <span className="min-w-0 flex-1">
                <Who name={t.label} sub={`${KIND_LABEL[t.kind]} · Version ${t.version ?? 0}`} />
              </span>
              {t.is_default && <Pill tone="ok">Default</Pill>}
              {!t.active && <Pill>Retired</Pill>}
              {configure && t.active && (
                <Button size="sm" icon="edit" aria-label={`Edit ${t.label}`} onClick={() => open(t)}>
                  Edit
                </Button>
              )}
              {configure && (
                <Menu
                  label={`${t.label} actions`}
                  trigger={(p) => <IconButton {...p} icon="dots" label={`More for ${t.label}`} size="sm" />}
                  items={[
                    ...(t.active && !t.is_default ? [{ label: "Make Default", icon: "ok" as const, onSelect: () => patch(t, { is_default: true }, "Default changed") }] : []),
                    t.active
                      ? { label: "Retire", icon: "x" as const, danger: true, onSelect: () => patch(t, { active: false }, "Template retired") }
                      : { label: "Restore", icon: "refresh" as const, onSelect: () => patch(t, { active: true }, "Template restored") },
                  ]}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ChecklistCard({ d, configure }: { d: CategoryDetail; configure: boolean }) {
  const modal = useModal();
  const phone = useIsPhone();
  const change = useMutation("PATCH /api/v1/partnerships/checklist-items/:id");
  const live = d.checklist.filter((i) => i.active);
  const open = (item?: ChecklistItem) => modal.open({ title: item ? "Edit Item" : "Add Item", body: (close) => <ChecklistForm category={d} item={item} close={close} /> });
  const patch = async (i: ChecklistItem, body: { position?: number; active?: boolean }, done?: string) => {
    try {
      await change.run({ params: { id: i.partner_category_checklist_item_id }, body });
      invalidate("/api/v1/partnerships/categories");
      if (done) toast(done);
    } catch (e) {
      toast(refusal(e, "Not saved. Try again."));
    }
  };
  const move = (i: ChecklistItem, by: -1 | 1) => {
    const at = live.findIndex((x) => x.partner_category_checklist_item_id === i.partner_category_checklist_item_id);
    return at + by < 0 || at + by >= live.length ? undefined : patch(i, { position: at + by });
  };
  return (
    <Card>
      <CardHeader
        title="Delivery Checklist"
        actions={configure ? <Button size="sm" icon="plus" onClick={() => open()}>Add Item</Button> : undefined}
      />
      {d.checklist.length === 0 ? (
        <EmptyState bare title="No Items Yet" text={configure ? "Add what MyCity delivers once a deal is signed." : undefined} />
      ) : (
        <ul className="divide-y divide-border">
          {d.checklist.map((i) => (
            <li key={i.partner_category_checklist_item_id} className="flex min-h-row items-center gap-2 py-1.5 phone:min-h-tap">
              <span className="min-w-0 flex-1">
                <Who name={i.title} sub={dueText(i)} />
              </span>
              {!i.active && <Pill>Retired</Pill>}
              {configure && i.active && !phone && (
                <>
                  <IconButton icon="up" label={`Move ${i.title} Up`} size="sm" onClick={() => move(i, -1)} />
                  <IconButton icon="down" label={`Move ${i.title} Down`} size="sm" onClick={() => move(i, 1)} />
                </>
              )}
              {configure && (
                <Menu
                  label={`${i.title} actions`}
                  trigger={(p) => <IconButton {...p} icon="dots" label={`More for ${i.title}`} size="sm" />}
                  items={[
                    { label: "Edit", icon: "edit" as const, onSelect: () => open(i) },
                    ...(phone && i.active
                      ? [{ label: "Move Up", icon: "up" as const, onSelect: () => move(i, -1) }, { label: "Move Down", icon: "down" as const, onSelect: () => move(i, 1) }]
                      : []),
                    i.active
                      ? { label: "Retire", icon: "x" as const, danger: true, onSelect: () => patch(i, { active: false }, "Item retired") }
                      : { label: "Restore", icon: "refresh" as const, onSelect: () => patch(i, { active: true }, "Item restored") },
                  ]}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function FieldsCard({ d, configure }: { d: CategoryDetail; configure: boolean }) {
  const modal = useModal();
  const change = useMutation("PATCH /api/v1/partnerships/fields/:id");
  const open = (field?: Field) => modal.open({ title: field ? "Edit Field" : "Add Field", body: (close) => <FieldForm category={d} field={field} close={close} /> });
  const setActive = async (f: Field, active: boolean) => {
    try {
      await change.run({ params: { id: f.partnership_field_id }, body: { active } });
      invalidate("/api/v1/partnerships/categories");
      toast(active ? "Field restored" : "Field retired");
    } catch (e) {
      toast(refusal(e, "Not saved. Try again."));
    }
  };
  return (
    <Card>
      <CardHeader
        title="Custom Fields"
        actions={configure ? <Button size="sm" icon="plus" onClick={() => open()}>Add Field</Button> : undefined}
      />
      {d.fields.length === 0 ? (
        <EmptyState bare title="No Fields Yet" text={configure ? "Add what MyCity records beyond the standard fields." : undefined} />
      ) : (
        <ul className="divide-y divide-border">
          {d.fields.map((f) => (
            <li key={f.partnership_field_id} className="flex min-h-row items-center gap-2 py-1.5 phone:min-h-tap">
              <span className="min-w-0 flex-1">
                <Who name={f.label} sub={`${FIELD_TYPE_LABEL[f.field_type]} · ${APPLIES_LABEL[f.applies_to]}${f.partner_category_id ? "" : " · All Categories"}`} />
              </span>
              {f.filterable && <Pill tone="info">Filterable</Pill>}
              {!f.active && <Pill>Retired</Pill>}
              {configure && (
                <Menu
                  label={`${f.label} actions`}
                  trigger={(p) => <IconButton {...p} icon="dots" label={`More for ${f.label}`} size="sm" />}
                  items={[
                    ...(f.active ? [{ label: "Edit", icon: "edit" as const, onSelect: () => open(f) }] : []),
                    f.active
                      ? { label: "Retire", icon: "x" as const, danger: true, onSelect: () => setActive(f, false) }
                      : { label: "Restore", icon: "refresh" as const, onSelect: () => setActive(f, true) },
                  ]}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
