import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { Editor } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import { createNotesExtensions } from "./notes-markdown";

// Lets the item form insert attachment links and keep a hidden field in sync.
export type NotesEditorApi = {
  insertMarkdown(markdown: string): void;
  // Replace the document from outside (inline board edits); ignored while the user
  // is typing in this editor, so the caret is never disturbed mid-keystroke.
  setMarkdown(markdown: string): void;
  focus(): void;
};

type FormatState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  bulletList: boolean;
  orderedList: boolean;
  blockquote: boolean;
  link: boolean;
  canSink: boolean;
  canLift: boolean;
};

const INACTIVE: FormatState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  bulletList: false,
  orderedList: false,
  blockquote: false,
  link: false,
  canSink: false,
  canLift: false,
};

/** A typed address as a link: a scheme is added when it's missing ("example.com" → https). */
export function normalizeHref(value: string) {
  const trimmed = value.trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : trimmed.includes("@") && !trimmed.includes("/") ? `mailto:${trimmed}` : `https://${trimmed}`;
}

// Only web and mail links open; attachment links belong to the task's attachments list.
function openLink(href: string) {
  if (/^(https?:|mailto:)/i.test(href)) window.open(href, "_blank", "noopener,noreferrer");
}

export function NotesEditor(props: {
  ariaLabel: string;
  placeholder: string;
  initialMarkdown: string;
  onChange: (markdown: string) => void;
  onEditor?: (api: NotesEditorApi | null) => void;
}) {
  let container!: HTMLDivElement;
  let editor: Editor | undefined;
  const [state, setState] = createSignal<FormatState>(INACTIVE);

  const refresh = () => {
    if (!editor) return;
    setState({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      bulletList: editor.isActive("bulletList"),
      orderedList: editor.isActive("orderedList"),
      blockquote: editor.isActive("blockquote"),
      link: editor.isActive("link"),
      canSink: editor.can().sinkListItem("listItem") || editor.can().sinkListItem("taskItem"),
      canLift: editor.can().liftListItem("listItem") || editor.can().liftListItem("taskItem"),
    });
  };

  let focused = false;
  onMount(() => {
    editor = new Editor({
      element: container,
      extensions: [...createNotesExtensions(), Placeholder.configure({ placeholder: props.placeholder })],
      content: props.initialMarkdown,
      contentType: "markdown",
      editorProps: {
        attributes: {
          class: "notes-richtext",
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": props.ariaLabel,
        },
      },
      onFocus: () => { focused = true; },
      onBlur: () => { focused = false; },
      onUpdate: () => {
        if (!editor) return;
        // Blank trailing paragraphs serialize as &nbsp;; notes don't need them.
        props.onChange(editor.getMarkdown().replace(/(?:&nbsp;|[\s ])+$/g, ""));
      },
      onTransaction: refresh,
    });
    refresh();
    props.onEditor?.({
      insertMarkdown: (markdown) => {
        editor?.chain().focus().insertContent(markdown, { contentType: "markdown" }).run();
      },
        setMarkdown: (markdown) => {
        if (!editor || focused) return;
        const current = editor.getMarkdown().replace(/(?:&nbsp;|[\s ])+$/g, "");
        // contentType reaches the Markdown extension's setContent override (untyped upstream).
        if (current !== markdown) editor.commands.setContent(markdown, { emitUpdate: false, contentType: "markdown" } as unknown as Parameters<typeof editor.commands.setContent>[1]);
      },
      focus: () => editor?.commands.focus(),
    });
  });

  onCleanup(() => {
    props.onEditor?.(null);
    editor?.destroy();
    editor = undefined;
  });

  const run = (command: (editor: Editor) => void) => {
    if (!editor) return;
    command(editor);
    refresh();
  };

  // Links: the toolbar's link button opens a small field to add, change, open, or remove one.
  const [linkDraft, setLinkDraft] = createSignal<string | null>(null);
  let linkInput: HTMLInputElement | undefined;
  const openLinkField = () => {
    if (!editor) return;
    setLinkDraft(editor.getAttributes("link").href || "");
    requestAnimationFrame(() => { linkInput?.focus(); linkInput?.select(); });
  };
  const applyLink = () => {
    const raw = (linkDraft() || "").trim();
    setLinkDraft(null);
    if (!editor) return;
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!raw) { chain.unsetLink().run(); refresh(); return; }
    const href = normalizeHref(raw);
    // With nothing selected, the address itself becomes the link's text.
    if (editor.state.selection.empty && !editor.isActive("link")) chain.insertContent({ type: "text", text: raw, marks: [{ type: "link", attrs: { href } }] }).run();
    else chain.setLink({ href }).run();
    refresh();
  };

  return (
    <div class="notes-richedit">
      <div class="notes-formatbar" role="toolbar" aria-label="Notes formatting">
        <button type="button" class="notes-format-button" aria-label="Bold" title="Bold (Ctrl+B)" aria-pressed={state().bold} onMouseDown={event => event.preventDefault()} onClick={() => run(e => { e.chain().focus().toggleBold().run(); })}><b>B</b></button>
        <button type="button" class="notes-format-button" aria-label="Italic" title="Italic (Ctrl+I)" aria-pressed={state().italic} onMouseDown={event => event.preventDefault()} onClick={() => run(e => { e.chain().focus().toggleItalic().run(); })}><i>I</i></button>
        <button type="button" class="notes-format-button" aria-label="Underline" title="Underline (Ctrl+U)" aria-pressed={state().underline} onMouseDown={event => event.preventDefault()} onClick={() => run(e => { e.chain().focus().toggleUnderline().run(); })}><u>U</u></button>
        <button type="button" class="notes-format-button" aria-label="Strikethrough" title="Strikethrough (Ctrl+Shift+S)" aria-pressed={state().strike} onMouseDown={event => event.preventDefault()} onClick={() => run(e => { e.chain().focus().toggleStrike().run(); })}><s>S</s></button>
        <span class="notes-format-sep" aria-hidden="true" />
        <button type="button" class="notes-format-button" aria-label="Bulleted list" title="Bulleted list (Ctrl+Shift+8)" aria-pressed={state().bulletList} onMouseDown={event => event.preventDefault()} onClick={() => run(e => { e.chain().focus().toggleBulletList().run(); })}>•</button>
        <button type="button" class="notes-format-button" aria-label="Numbered list" title="Numbered list (Ctrl+Shift+7)" aria-pressed={state().orderedList} onMouseDown={event => event.preventDefault()} onClick={() => run(e => { e.chain().focus().toggleOrderedList().run(); })}>1.</button>
        <span class="notes-format-sep" aria-hidden="true" />
        <button type="button" class="notes-format-button" aria-label="Decrease indent" title="Decrease indent (Ctrl+[)" disabled={!state().canLift} onMouseDown={event => event.preventDefault()} onClick={() => run(e => { e.chain().focus().liftListItem("listItem").liftListItem("taskItem").run(); })}>⇤</button>
        <button type="button" class="notes-format-button" aria-label="Increase indent" title="Increase indent (Ctrl+])" disabled={!state().canSink} onMouseDown={event => event.preventDefault()} onClick={() => run(e => { e.chain().focus().sinkListItem("listItem").sinkListItem("taskItem").run(); })}>⇥</button>
        <span class="notes-format-sep" aria-hidden="true" />
        <button type="button" class="notes-format-button" aria-label="Link" title="Add or edit a link (Ctrl+K); Ctrl+click a link to open it" aria-pressed={state().link} onMouseDown={event => event.preventDefault()} onClick={openLinkField}>🔗</button>
        <button type="button" class="notes-format-button" aria-label="Quote block" title="Quote block (Ctrl+Shift+B)" aria-pressed={state().blockquote} onMouseDown={event => event.preventDefault()} onClick={() => run(e => { e.chain().focus().toggleBlockquote().run(); })}>❞</button>
      </div>
      <Show when={linkDraft() !== null}>
        <form class="notes-link-field" onSubmit={event => { event.preventDefault(); applyLink(); }} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setLinkDraft(null); editor?.commands.focus(); } }}>
          <input ref={linkInput} data-editor-ignore aria-label="Link address" placeholder="https://example.com" value={linkDraft() || ""} onInput={event => setLinkDraft(event.currentTarget.value)} />
          <button type="submit" class="text-button">{linkDraft() ? "Apply" : "Remove link"}</button>
          <Show when={linkDraft()}><button type="button" class="text-button" onClick={() => openLink(normalizeHref(linkDraft() || ""))}>Open</button></Show>
          <button type="button" class="text-button" onClick={() => { setLinkDraft(null); editor?.commands.focus(); }}>Cancel</button>
        </form>
      </Show>
      {/* Ctrl/Cmd+click follows a link; a plain click places the caret to edit it. */}
      <div ref={container} class="notes-richedit-body" onClick={event => {
        const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
        if (link && (event.ctrlKey || event.metaKey)) { event.preventDefault(); openLink(link.getAttribute("href") || ""); }
      }} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openLinkField(); } }} />
    </div>
  );
}
