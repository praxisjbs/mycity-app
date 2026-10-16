/**
 * The rich text editor's own chunk (F22, PR 3 question 3): TipTap over
 * ProseMirror, loaded only by a screen that opens a composer.
 *
 * Selection, paste sanitising, lists and undo are what this is here for. Mail
 * and announcements take text pasted from Word and Gmail, and ProseMirror
 * parses it into the document's own schema rather than letting a wall of
 * foreign markup into the body. Nothing below the toolbar sets a colour or a
 * size itself: `.rte` in base.css styles the content with tokens.
 */
import { useEffect, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import Link from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import { cn } from "../lib/cn";
import { Icon, type IconName } from "../icons/Icon";
import { Button } from "../actions/Button";
import { InlineInput } from "./InlineInput";

export interface RichTextDrawProps {
  value: string;
  onChange: (html: string) => void;
  onBlur?: () => void;
  placeholder: string;
  label: string;
  readOnly?: boolean;
  bad?: boolean;
  /** The id the Field gave, so its label names this box. */
  id?: string;
  describedBy?: string;
}

/**
 * The toolbar: what the mailbox's composer carries (docs/guides/mailbox.md §6,
 * §10) and an announcement needs, and nothing else.
 */
const BUTTONS: Array<{ icon: IconName; label: string; mark: string; attrs?: Record<string, unknown> }> = [
  { icon: "bold", label: "Bold", mark: "bold" },
  { icon: "italic", label: "Italic", mark: "italic" },
  { icon: "underline", label: "Underline", mark: "underline" },
  { icon: "strike", label: "Strikethrough", mark: "strike" },
  { icon: "heading", label: "Heading", mark: "heading", attrs: { level: 2 } },
  { icon: "list", label: "Bulleted List", mark: "bulletList" },
  { icon: "listnum", label: "Numbered List", mark: "orderedList" },
  { icon: "quote", label: "Quote", mark: "blockquote" },
];

/** A link may only point at a page or an address (docs/guides/mailbox.md §6). */
const LINK_OK = /^(https:\/\/|mailto:)/;

export default function RichTextDraw({ value, onChange, onBlur, placeholder, label, readOnly, bad, id, describedBy }: RichTextDrawProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, link: false }),
      Link.configure({ openOnClick: false, autolink: true, protocols: ["https", "mailto"] }),
    ],
    content: value,
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: "rte min-h-28 w-full px-3 py-2 text-field outline-none",
        "data-ph": placeholder,
        ...(id ? { id } : {}),
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        "aria-label": label,
        role: "textbox",
        "aria-multiline": "true",
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.isEmpty ? "" : e.getHTML()),
    onBlur: () => onBlur?.(),
  });

  // A draft restored from elsewhere (a wizard step, a reopened composer) has to
  // reach the document, but replacing it on every keystroke would move the caret.
  useEffect(() => {
    if (editor && !editor.isFocused && value !== (editor.isEmpty ? "" : editor.getHTML())) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  /*
   * TipTap 3's useEditor does NOT re-render on a transaction, so the toolbar
   * has to subscribe to the few things it shows: which marks the caret is in,
   * and whether there is anything to undo. Without this the buttons would
   * stay as they were when the editor mounted.
   */
  const marks = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            active: Object.fromEntries(BUTTONS.map((b) => [b.mark, e.isActive(b.mark, b.attrs)])),
            linked: e.isActive("link"),
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
          }
        : null,
  });

  // The link's address is typed in the toolbar, never in a native dialog (gate 16).
  const [linkOpen, setLinkOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [addressBad, setAddressBad] = useState(false);

  const addLink = () => {
    const href = address.trim();
    if (!LINK_OK.test(href)) {
      setAddressBad(true);
      return;
    }
    editor?.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkOpen(false);
    setAddress("");
  };

  if (!editor) return null;

  return (
    <div className={cn("overflow-hidden rounded-ctl border bg-background", bad ? "border-destructive" : "border-input", "focus-within:border-ring")}>
      {!readOnly && (
        <div role="group" aria-label={`${label} formatting`} className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted px-1.5 py-1">
          {BUTTONS.map((button) => {
            const on = marks?.active[button.mark] ?? false;
            return (
              <button
                key={button.mark}
                type="button"
                aria-label={button.label}
                aria-pressed={on}
                onClick={() => {
                  const chain = editor.chain().focus();
                  if (button.mark === "bold") chain.toggleBold().run();
                  else if (button.mark === "italic") chain.toggleItalic().run();
                  else if (button.mark === "heading") chain.toggleHeading({ level: 2 }).run();
                  else if (button.mark === "bulletList") chain.toggleBulletList().run();
                  else if (button.mark === "orderedList") chain.toggleOrderedList().run();
                  else chain.toggleBlockquote().run();
                }}
                className={cn(
                  "flex size-8 items-center justify-center rounded-ctl text-muted-foreground hover:bg-accent hover:text-accent-foreground phone:size-tap",
                  on && "bg-accent text-accent-foreground",
                )}
              >
                <Icon name={button.icon} size="s" />
              </button>
            );
          })}
          <button
            type="button"
            aria-label="Link"
            aria-expanded={linkOpen}
            onClick={() => {
              setAddressBad(false);
              setLinkOpen((open) => !open);
            }}
            className={cn(
              "flex size-8 items-center justify-center rounded-ctl text-muted-foreground hover:bg-accent hover:text-accent-foreground phone:size-tap",
              (linkOpen || marks?.linked) && "bg-accent text-accent-foreground",
            )}
          >
            <Icon name="link" size="s" />
          </button>
          <button
            type="button"
            aria-label="Clear Formatting"
            onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
            className="flex size-8 items-center justify-center rounded-ctl text-muted-foreground hover:bg-accent hover:text-accent-foreground phone:size-tap"
          >
            <Icon name="x" size="s" />
          </button>
          <span className="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              aria-label="Undo"
              disabled={!marks?.canUndo}
              onClick={() => editor.chain().focus().undo().run()}
              className="flex size-8 items-center justify-center rounded-ctl text-muted-foreground hover:bg-accent disabled:opacity-40 phone:size-tap"
            >
              <Icon name="undo" size="s" />
            </button>
            <button
              type="button"
              aria-label="Redo"
              disabled={!marks?.canRedo}
              onClick={() => editor.chain().focus().redo().run()}
              className="flex size-8 items-center justify-center rounded-ctl text-muted-foreground hover:bg-accent disabled:opacity-40 phone:size-tap"
            >
              <Icon name="redo" size="s" />
            </button>
          </span>
          {linkOpen && (
            <span className="flex basis-full items-center gap-1.5 pt-1.5">
              <InlineInput
                autoFocus
                value={address}
                onChange={(value) => {
                  setAddress(value);
                  setAddressBad(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addLink();
                  }
                }}
                placeholder="https://"
                aria-label="Link address"
                className={cn("h-control min-w-0 flex-1 rounded-ctl border bg-background px-2.5 text-field outline-none", addressBad ? "border-destructive" : "border-input focus:border-ring")}
              />
              <Button size="sm" onClick={addLink}>
                Add Link
              </Button>
              {addressBad && <span className="text-2xs text-destructive">Starts with https:// or mailto:</span>}
            </span>
          )}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
