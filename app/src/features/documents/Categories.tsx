/**
 * Document Centre · Categories (#114, docs/guides/document-centre.md §2, §6.4, §10): the categories
 * company documents are kept in, who sees each (everyone, or named roles) and how many documents it
 * holds, for those who keep the library (`documents.manage`). The list beside the picked category on
 * a wide desktop, a sheet on a phone (ListDetail, F31). New Category, Edit Category, Archive Category
 * and Restore Category; a category in use is archived, never deleted, and its documents stay.
 */
import { useState } from "react";
import librarySchemas from "@mycity/contract/schemas/library.js";
import type { DocumentCategory, RoleOption } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useRouter } from "@/lib/router";
import { useTrailTitle } from "@/lib/trail";
import { useScreenAction, useUrlAction } from "@/shell/screen-action";
import {
  Button,
  Card,
  CardHeader,
  ChoiceField,
  DataView,
  DesktopOnly,
  EmptyState,
  Field,
  FilterSelect,
  FormError,
  FormFooter,
  HelpTerm,
  KeyValue,
  ListDetail,
  LoadingRows,
  PageHeader,
  Pill,
  RecordPicker,
  TextAreaField,
  TextField,
  toast,
  useConfirm,
  useContractForm,
  useModal,
  useSideBySide,
} from "@mycity/ui";

const HERE = "/documents?tab=categories";
const SEEN_BY_HELP = "Who finds its documents in the Library. Their uploader and document managers always see them.";
const AUDIENCES: Array<["everyone" | "roles", string]> = [
  ["everyone", "Everyone"],
  ["roles", "Named Roles"],
];

const refresh = () => invalidate("/api/v1/library");

/** Who sees a category, as a person reads it. */
const seenBy = (c: DocumentCategory) => (c.audience === "everyone" ? "Everyone" : c.roles.length ? c.roles.map((r) => r.name).join(", ") : "No Roles");

export function Categories({ id }: { id: string | null }) {
  const { navigate } = useRouter();
  const modal = useModal();
  const beside = useSideBySide();
  const [archived, setArchived] = useState("");
  const list = usePaged("GET /api/v1/library/categories", { filters: archived ? { archived: "true" as const } : {} });
  const openOne = (categoryId: string) => navigate(`${HERE}&id=${categoryId}`);
  const shown = id ?? (beside ? (list.rows[0]?.document_category_id ?? null) : null);
  const add = () =>
    modal.open({
      title: "New Category",
      body: (close) => (
        <CategoryForm
          category={null}
          close={close}
          onSaved={(c) => {
            refresh();
            openOne(c.document_category_id);
          }}
        />
      ),
    });
  useScreenAction({ label: "New Document Category", onSelect: add });
  useUrlAction("new", add);
  return (
    <>
      <PageHeader
        title="Categories"
        sub="Where company documents are kept"
        actions={
          <DesktopOnly>
            <Button variant="primary" icon="plus" onClick={add}>
              New Category
            </Button>
          </DesktopOnly>
        }
      />
      <ListDetail
        open={Boolean(id)}
        onClose={() => navigate(HERE)}
        title="Category"
        list={
          <DataView<DocumentCategory>
            title="Categories"
            list={list}
            search="Search categories"
            rowKey={(c) => c.document_category_id}
            noun="category"
            nounPlural="categories"
            onRowClick={(c) => openOne(c.document_category_id)}
            selectedKey={beside ? shown : null}
            actions={
              <FilterSelect
                label="Show"
                value={archived}
                onChange={setArchived}
                options={[
                  ["", "Current"],
                  ["true", "Archived"],
                ]}
              />
            }
            empty={
              list.q || archived
                ? { title: "No Categories Found", text: "Try another search.", icon: "doc" }
                : { title: "No Categories Yet", icon: "doc" }
            }
            columns={[
              { key: "name", label: "Category", sortable: true, render: (c) => <span className="font-medium" data-copy="content">{c.name}</span> },
              {
                key: "seen",
                label: "Seen By",
                render: (c) => (c.audience === "roles" && c.roles.length === 0 ? <Pill tone="warn">No Roles</Pill> : <span data-copy="content">{seenBy(c)}</span>),
              },
              { key: "documents", label: "Documents", render: (c) => String(c.documents) },
            ]}
          />
        }
        detail={shown && <CategoryPanel key={shown} id={shown} onGone={() => navigate(HERE)} />}
      />
    </>
  );
}

/** One category: who sees it, how many documents it holds, and Edit Category, Archive or Restore. */
function CategoryPanel({ id, onGone }: { id: string; onGone: () => void }) {
  const modal = useModal();
  const confirm = useConfirm();
  const read = useApi("GET /api/v1/library/categories/:id", { params: { id } });
  const archive = useMutation("POST /api/v1/library/categories/:id/archive");
  const restore = useMutation("POST /api/v1/library/categories/:id/restore");
  const c = read.data;
  useTrailTitle(c?.name);
  if (read.error) {
    return (
      <Card>
        <EmptyState bare title="Category Not Found" text="It was removed, or is not yours." icon="doc" action={<Button onClick={onGone}>Back to Categories</Button>} />
      </Card>
    );
  }
  if (!c) {
    return (
      <Card>
        <LoadingRows />
      </Card>
    );
  }
  const edit = () => modal.open({ title: "Edit Category", body: (close) => <CategoryForm category={c} close={close} onSaved={refresh} /> });
  const putAway = async () => {
    if (!(await confirm({ title: "Archive Category", body: `${c.name} is no longer offered on Upload Document. Its documents stay.`, confirmLabel: "Archive Category", destructive: true }))) return;
    await archive.run({ params: { id: c.document_category_id }, body: {} });
    refresh();
    toast("Category archived");
  };
  const bringBack = async () => {
    await restore.run({ params: { id: c.document_category_id }, body: {} });
    refresh();
    toast("Category restored");
  };
  return (
    <Card>
      <CardHeader record title={c.name} right={c.archived_at ? <Pill tone="neutral">Archived</Pill> : null} />
      <KeyValue
        items={[
          [<HelpTerm key="s" help={SEEN_BY_HELP}>Seen By</HelpTerm>, <span key="v" data-copy="content">{seenBy(c)}</span>],
          ["Documents", String(c.documents)],
          ...(c.description ? [["Description", <span key="d" data-copy="content">{c.description}</span>] as [string, JSX.Element]] : []),
        ]}
      />
      <FormFooter>
        {c.archived_at ? (
          <Button onClick={bringBack}>Restore Category</Button>
        ) : (
          <>
            <Button variant="danger" onClick={putAway}>
              Archive Category
            </Button>
            <Button variant="primary" icon="edit" onClick={edit}>
              Edit Category
            </Button>
          </>
        )}
      </FormFooter>
    </Card>
  );
}

/** New Category and Edit Category: its name, what it holds, and who sees it. */
function CategoryForm({ category, close, onSaved }: { category: DocumentCategory | null; close: () => void; onSaved: (c: DocumentCategory) => void }) {
  const f = useContractForm(
    {
      name: category?.name ?? "",
      description: category?.description ?? "",
      audience: category?.audience ?? ("everyone" as "everyone" | "roles"),
      role_ids: category?.roles.map((r) => r.role_id) ?? ([] as string[]),
    },
    category ? librarySchemas.DocumentCategoryUpdate : librarySchemas.DocumentCategoryCreate,
  );
  const roles = usePaged("GET /api/v1/access/roles", { filters: {} });
  const [picked, setPicked] = useState<Array<Pick<RoleOption, "role_id" | "name">>>(category?.roles ?? []);
  const [problem, setProblem] = useState<string | null>(null);
  const create = useMutation("POST /api/v1/library/categories");
  const update = useMutation("PATCH /api/v1/library/categories/:id");
  const pick = (rows: Array<Pick<RoleOption, "role_id" | "name">>) => {
    setPicked(rows);
    f.set("role_ids", rows.map((r) => r.role_id));
  };
  const save = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      const body = { ...f.values, role_ids: f.values.audience === "roles" ? f.values.role_ids : [] };
      const saved = category ? await update.run({ params: { id: category.document_category_id }, body }) : await create.run({ body });
      close();
      onSaved(saved);
      toast(category ? "Category saved" : "Category added");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else setProblem(e instanceof ApiError ? e.message : "Not saved. Try again.");
    }
  };
  return (
    <>
      <Field label="Name" {...f.status("name")}>
        <TextField {...f.field("name")} placeholder="Licences" maxLength={80} />
      </Field>
      <Field label="Description" optional {...f.status("description")}>
        <TextAreaField {...f.field("description")} rows={2} maxLength={500} />
      </Field>
      <Field label="Seen By" {...f.status("audience")}>
        <ChoiceField value={f.values.audience} onChange={(v: string) => f.set("audience", v as "everyone" | "roles")} options={AUDIENCES} />
      </Field>
      {f.values.audience === "roles" && (
        <Field label="Roles" {...f.status("role_ids")}>
          <RecordPicker list={roles} value={picked} onChange={pick} id={(r) => r.role_id} title={(r) => r.name} multiple placeholder="Role name" />
        </Field>
      )}
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={save}>
          {category ? "Save Category" : "Create Category"}
        </Button>
      </FormFooter>
    </>
  );
}
