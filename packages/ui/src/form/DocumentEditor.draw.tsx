/**
 * The agreement editor's own chunk (F22): TipTap over ProseMirror with tables and the field chip, loaded
 * only by the screen that edits a template.
 *
 * A chip is an inline atom. In the page it reads as its label ("Business Name"); in the HTML the editor
 * hands back it is `<span data-field data-label>{{ tag }}</span>`, the text the server keeps as the
 * template's wording, so no one types braces and no brace is lost. Nothing here sets a colour or a size:
 * `.rte` and `.rte-chip` in base.css style the content with tokens.
 */
import { useEffect, useMemo } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { cn } from "../lib/cn";
import { Icon, type IconName } from "../icons/Icon";
import { InlineSelect } from "./InlineInput";
import type { DocumentEditorField } from "./DocumentEditor";

export interface DocumentEditorDrawProps {
  value: string;
  onChange: (html: string) => void;
  onBlur?: () => void;
  placeholder: string;
  label: string;
  fields: DocumentEditorField[];
  readOnly?: boolean;
  bad?: boolean;
  id?: string;
  describedBy?: string;
}

/** A named value in the wording, one unit that backspace removes whole. */
const FieldChip = Node.create({
  name: "fieldChip",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { field: { default: "" }, label: { default: "" }, tag: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-field]",
        getAttrs: (el) => {
          const span = el as HTMLElement;
          const field = span.getAttribute("data-field") ?? "";
          return { field, label: span.getAttribute("data-label") || field, tag: (span.textContent ?? "").trim() || `{{ ${field} }}` };
        },
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes({ "data-field": node.attrs.field, "data-label": node.attrs.label }, { class: HTMLAttributes.class }), node.attrs.tag];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "rte-chip";
      dom.contentEditable = "false";
      dom.setAttribute("data-field", node.attrs.field);
      dom.textContent = node.attrs.label;
      return { dom };
    };
  },
});

/** A value that changed outside the box reaches the document, unless the editor is gone or being typed in. */
function syncDraft(editor: Editor | null, value: string) {
  if (!editor || editor.isDestroyed || editor.isFocused) return;
  if (value !== (editor.isEmpty ? "" : editor.getHTML())) editor.commands.setContent(value, { emitUpdate: false });
}

const MARKS: Array<{ icon: IconName; label: string; mark: string; attrs?: Record<string, unknown> }> = [
  { icon: "bold", label: "Bold", mark: "bold" },
  { icon: "italic", label: "Italic", mark: "italic" },
  { icon: "heading", label: "Heading", mark: "heading", attrs: { level: 2 } },
  { icon: "list", label: "Bulleted List", mark: "bulletList" },
  { icon: "listnum", label: "Numbered List", mark: "orderedList" },
];

const BUTTON = "flex size-8 items-center justify-center rounded-ctl text-muted-foreground hover:bg-accent hover:text-accent-foreground phone:size-tap";
const TEXT_BUTTON = "flex h-8 items-center gap-1 rounded-ctl px-2 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground phone:h-tap";

/** Insert Field's list: each field under its group, so a long catalogue reads in order. */
const optionsOf = (fields: DocumentEditorField[]): Array<[string, string]> => fields.map((f) => [f.field, f.group ? `${f.group}: ${f.label}` : f.label]);

export default function DocumentEditorDraw({ value, onChange, onBlur, placeholder, label, fields, readOnly, bad, id, describedBy }: DocumentEditorDrawProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, link: false, blockquote: false, strike: false, underline: false }),
      Table,
      TableRow,
      TableHeader,
      TableCell,
      FieldChip,
    ],
    content: value,
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: "rte min-h-72 w-full px-3 py-2 text-field outline-none",
        "data-ph": placeholder,
        ...(id ? { id } : {}),
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        "aria-label": label,
        role: "textbox",
        "aria-multiline": "true",
        // The wording is what a person wrote: content, not interface copy (FRONTEND_GUIDE §5), so a
        // table in it is part of the document and the gates do not ask for it to be cards.
        "data-copy": "content",
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.isEmpty ? "" : e.getHTML()),
    onBlur: () => onBlur?.(),
  });

  useEffect(() => syncDraft(editor, value), [editor, value]);
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e && !e.isDestroyed
        ? {
            active: Object.fromEntries(MARKS.map((b) => [b.mark, e.isActive(b.mark, b.attrs)])),
            inTable: e.isActive("table"),
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
          }
        : null,
  });

  const byField = useMemo(() => new Map(fields.map((f) => [f.field, f])), [fields]);
  const options = useMemo(() => optionsOf(fields), [fields]);

  if (!editor) return null;

  const insert = (field: string) => {
    const f = byField.get(field);
    if (!f) return;
    editor.chain().focus().insertContent([{ type: "fieldChip", attrs: { field: f.field, label: f.label, tag: f.tag } }, { type: "text", text: " " }]).run();
  };

  const run = (name: string) => {
    const chain: ReturnType<Editor["chain"]> = editor.chain().focus();
    if (name === "bold") chain.toggleBold().run();
    else if (name === "italic") chain.toggleItalic().run();
    else if (name === "heading") chain.toggleHeading({ level: 2 }).run();
    else if (name === "bulletList") chain.toggleBulletList().run();
    else chain.toggleOrderedList().run();
  };

  return (
    <div className={cn("overflow-hidden rounded-ctl border bg-background", bad ? "border-destructive" : "border-input", "focus-within:border-ring")}>
      {!readOnly && (
        <div role="group" aria-label={`${label} formatting`} className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted px-1.5 py-1">
          {MARKS.map((b) => (
            <button
              key={b.mark}
              type="button"
              aria-label={b.label}
              aria-pressed={state?.active[b.mark] ?? false}
              onClick={() => run(b.mark)}
              className={cn(BUTTON, state?.active[b.mark] && "bg-accent text-accent-foreground")}
            >
              <Icon name={b.icon} size="s" />
            </button>
          ))}
          <button type="button" aria-label="Insert Table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} className={BUTTON}>
            <Icon name="table" size="s" />
          </button>
          {state?.inTable && (
            <>
              <button type="button" onClick={() => editor.chain().focus().addRowAfter().run()} className={TEXT_BUTTON}>
                <Icon name="plus" size="s" />
                Add Row
              </button>
              <button type="button" onClick={() => editor.chain().focus().addColumnAfter().run()} className={TEXT_BUTTON}>
                <Icon name="plus" size="s" />
                Add Column
              </button>
              <button type="button" onClick={() => editor.chain().focus().deleteRow().run()} className={TEXT_BUTTON}>
                <Icon name="minus" size="s" />
                Delete Row
              </button>
              <button type="button" onClick={() => editor.chain().focus().deleteTable().run()} className={TEXT_BUTTON}>
                <Icon name="trash" size="s" />
                Delete Table
              </button>
            </>
          )}
          <InlineSelect
            value=""
            onChange={insert}
            options={options}
            searchable
            placeholder="Insert Field"
            label="Insert Field"
            aria-label="Insert Field"
            className="flex h-8 items-center gap-1.5 rounded-ctl border border-input bg-background px-2.5 text-xs text-foreground phone:h-tap"
          />
          <span className="ml-auto flex items-center gap-0.5">
            <button type="button" aria-label="Undo" disabled={!state?.canUndo} onClick={() => editor.chain().focus().undo().run()} className={cn(BUTTON, "disabled:opacity-40")}>
              <Icon name="undo" size="s" />
            </button>
            <button type="button" aria-label="Redo" disabled={!state?.canRedo} onClick={() => editor.chain().focus().redo().run()} className={cn(BUTTON, "disabled:opacity-40")}>
              <Icon name="redo" size="s" />
            </button>
          </span>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
