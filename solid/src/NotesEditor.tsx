import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Editor, Node as TiptapNode, type MarkViewRenderer } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import type { Mark, Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, type EditorState } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import type { MarkView } from "@tiptap/pm/view";
import { createNotesExtensions } from "./notes-markdown";

// Lets the item form insert attachment links and keep a hidden field in sync.
export type NotesEditorApi = {
  // A link in the line at the caret (the end of the notes if they haven't been in use), set off by a space.
  insertLink(text: string, href: string): void;
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

// Web and mail links open in a new tab; an attachment link downloads its file (see onDownload).
function openLink(href: string) {
  if (/^(https?:|mailto:)/i.test(href)) window.open(href, "_blank", "noopener,noreferrer");
}

const ATTACHMENT = "attachment:";
const attachmentIdOf = (href: string) => href.toLowerCase().startsWith(ATTACHMENT) ? decodeURIComponent(href.slice(ATTACHMENT.length)) : null;

/*
 * A file link starts with a paperclip, a character of its own that carries the link: the caret
 * right of it is in the link (typing there adds to the link's text), left of it is outside. Each
 * file link gets exactly one, kept as links are typed, pasted, undone or unlinked; the notes'
 * markdown never has it. Backspace right of it takes out the whole link; Delete left of it steps over it.
 */
const CLIP = "attachmentClip";
const fileLinkOf = (node: ProseMirrorNode) => node.marks.find(mark => mark.type.name === "link" && attachmentIdOf(String(mark.attrs.href || "")) != null);
function placeClips(state: EditorState) {
  const tr = state.tr, clip = state.schema.nodes[CLIP];
  state.doc.descendants((block, pos) => {
    if (!block.inlineContent) return true;
    let offset = pos + 1;
    for (let index = 0; index < block.childCount; index++) {
      const node = block.child(index), before = index ? block.child(index - 1) : null, after = index + 1 < block.childCount ? block.child(index + 1) : null;
      const link = fileLinkOf(node);
      if (node.type === clip) {
        const starts = link && after?.isText && link.isInSet(after.marks) && !(before && before.type !== clip && link.isInSet(before.marks));
        if (!starts) tr.delete(tr.mapping.map(offset), tr.mapping.map(offset + node.nodeSize));
      } else if (node.isText && link && !(before && link.isInSet(before.marks))) tr.insert(tr.mapping.map(offset), clip.create(null, null, node.marks));
      offset += node.nodeSize;
    }
    return false;
  });
  return tr.docChanged ? tr : null;
}
// Where the file link `link`, from `from` on, ends.
function linkEnd(doc: ProseMirrorNode, from: number, link: Mark) {
  const $from = doc.resolve(from);
  let end = from;
  for (let index = $from.index(); index < $from.parent.childCount && link.isInSet($from.parent.child(index).marks); index++) end += $from.parent.child(index).nodeSize;
  return end;
}
const AttachmentClip = TiptapNode.create({
  name: CLIP,
  inline: true,
  group: "inline",
  atom: true,
  selectable: false,
  draggable: false,
  priority: 1000,
  parseHTML: () => [{ tag: "span.attachment-clip" }],
  renderHTML: () => ["span", { class: "attachment-clip" }, "📎"],
  renderText: () => "",
  renderMarkdown: () => "",
  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { selection, doc } = this.editor.state, clip = selection.$from.nodeBefore;
        const link = selection.empty && clip?.type.name === CLIP ? fileLinkOf(clip) : undefined;
        return !!link && this.editor.commands.deleteRange({ from: selection.from - 1, to: linkEnd(doc, selection.from, link) });
      },
      Delete: () => {
        const { selection } = this.editor.state;
        return selection.empty && selection.$from.nodeAfter?.type.name === CLIP && this.editor.commands.setTextSelection(selection.from + 1);
      },
    };
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction: (transactions, previous, state) => {
        if (!transactions.some(tr => tr.docChanged)) return null;
        // A phone keyboard's backspace (from right of a paperclip) takes out just the paperclip: the rest of its link goes too.
        const [only] = transactions, step = only.steps[0];
        if (transactions.length === 1 && only.steps.length === 1 && step instanceof ReplaceStep && !step.slice.size && step.to === step.from + 1
          && previous.selection.empty && previous.selection.from === step.to && only.docs[0].nodeAt(step.from)?.type.name === CLIP) {
          const link = fileLinkOf(only.docs[0].nodeAt(step.from)!), after = state.doc.nodeAt(step.from);
          if (link && after && link.isInSet(after.marks)) return state.tr.delete(step.from, linkEnd(state.doc, step.from, link));
        }
        return placeClips(state);
      },
      // The caret right of a paperclip goes at the start of the link's text, where Chrome shows it
      // right of the paperclip (between the two elements, it can show it left of it).
      view: () => ({
        update: view => {
          const { selection } = view.state, dom = view.dom.ownerDocument.getSelection();
          if (!dom || view.composing || !view.hasFocus() || !selection.empty || selection.$from.nodeBefore?.type.name !== CLIP) return;
          const at = view.domAtPos(selection.from, 1);
          if (at.node.nodeType === 3 && (dom.anchorNode !== at.node || dom.anchorOffset !== at.offset)) dom.collapse(at.node, at.offset);
        },
      }),
    })];
  },
  onCreate() {
    const tr = placeClips(this.editor.state);
    if (tr) this.editor.view.dispatch(tr.setMeta("addToHistory", false).setMeta("preventUpdate", true));
  },
});

/*
 * A link to one of the item's files is stored by the file's id ("attachment:<id>"), whatever its
 * text says. Shown, it's marked as a file link; as removed when no file has that id any more
 * (undoing the removal brings it back); and lit while its file's row is pointed at. The marks go
 * on the link itself: a wrapper around its text would split it from the paperclip, and a phone
 * keyboard typing right of the paperclip would land between them.
 */
function fileLinkViews(look: () => { files: ReadonlyMap<string, string>; lit: string | null }) {
  const shown = new Map<HTMLAnchorElement, string>();
  // Data attributes only: the browser can copy the element while a phone keyboard composes in it,
  // and a copy's class or title would read back as a different link.
  const paint = (link: HTMLAnchorElement, id: string) => {
    const { files, lit } = look();
    link.toggleAttribute("data-missing", !files.has(id));
    link.toggleAttribute("data-lit", lit === id);
  };
  // Other links render as usual.
  const view: MarkViewRenderer = ({ mark, HTMLAttributes }) => {
    const id = attachmentIdOf(String(mark.attrs.href || ""));
    if (id == null) return undefined as unknown as MarkView;
    const link = document.createElement("a");
    for (const [name, value] of Object.entries(HTMLAttributes)) if (value != null) link.setAttribute(name, String(value));
    link.dataset.attachmentId = id;
    shown.set(link, id);
    paint(link, id);
    return { dom: link, ignoreMutation: mutation => mutation.type === "attributes" && mutation.target === link, destroy: () => shown.delete(link) };
  };
  return { view, repaint: () => shown.forEach((id, link) => paint(link, id)) };
}

// What the bubble under the link the caret is in says and offers.
type Bubble = { href: string; file: { id: string; name: string | null } | null; top: number; left: number };

export function NotesEditor(props: {
  ariaLabel: string;
  placeholder: string;
  initialMarkdown: string;
  onChange: (markdown: string) => void;
  onEditor?: (api: NotesEditorApi | null) => void;
  // The item's files (id → name), a file link's download, and which file is pointed at (lit
  // here, from its row; `onLight` when its link is pointed at here).
  files?: () => ReadonlyMap<string, string>;
  lit?: () => string | null;
  onLight?: (id: string | null) => void;
  onDownload?: (id: string) => void;
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
  // Whether the caret's been put somewhere: until then a link goes at the end, not the start.
  let used = false;
  const noFiles: ReadonlyMap<string, string> = new Map();
  const files = () => props.files?.() ?? noFiles;
  const fileLinks = fileLinkViews(() => ({ files: files(), lit: props.lit?.() ?? null }));
  // The caret in a link shows a bubble under it: a file link's file (or that it's gone), or a
  // web link's address, with what you can do with it. Clicking a link still just edits it.
  const [bubble, setBubble] = createSignal<Bubble | null>(null);
  let root!: HTMLDivElement;
  const placeBubble = () => {
    if (!editor || !focused || !editor.isActive("link")) { setBubble(null); return; }
    const href = String(editor.getAttributes("link").href || "");
    const at = editor.view.domAtPos(editor.state.selection.from);
    const element = at.node.nodeType === Node.TEXT_NODE ? at.node.parentElement : at.node as Element;
    const anchor = element?.closest("a") ?? element?.querySelector?.("a");
    const box = anchor?.getBoundingClientRect() ?? editor.view.coordsAtPos(editor.state.selection.from);
    const frame = root.getBoundingClientRect();
    const id = attachmentIdOf(href);
    setBubble({ href, file: id == null ? null : { id, name: files().get(id) ?? null }, top: box.bottom - frame.top + 4, left: Math.max(0, Math.min(box.left - frame.left, frame.width - 260)) });
  };
  onMount(() => {
    editor = new Editor({
      element: container,
      extensions: [...createNotesExtensions({ linkView: fileLinks.view }), AttachmentClip, Placeholder.configure({ placeholder: props.placeholder })],
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
      onFocus: () => { focused = used = true; placeBubble(); },
      onBlur: () => { focused = false; setBubble(null); },
      onSelectionUpdate: placeBubble,
      onUpdate: () => {
        if (!editor) return;
        // Blank trailing paragraphs serialize as &nbsp;; notes don't need them.
        props.onChange(editor.getMarkdown().replace(/(?:&nbsp;|[\s ])+$/g, ""));
      },
      onTransaction: () => { refresh(); placeBubble(); },
    });
    refresh();
    props.onEditor?.({
      insertLink: (text, href) => {
        if (!editor) return;
        editor.commands.focus(used ? undefined : "end");
        const { $from } = editor.state.selection;
        const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc");
        editor.chain().insertContent([
          ...(before && !/\s$/.test(before) ? [{ type: "text", text: " " }] : []),
          { type: "text", text, marks: [{ type: "link", attrs: { href } }] },
        ]).run();
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

  // The files or the lit one changed: mark the links again.
  createEffect(() => {
    files(); props.lit?.();
    fileLinks.repaint();
  });
  const unlink = () => { editor?.chain().focus().extendMarkRange("link").unsetLink().run(); refresh(); };
  // Ctrl/Cmd+click, or the bubble: a file link downloads (if the file's still there), a web link opens.
  const follow = (href: string) => {
    const id = attachmentIdOf(href);
    if (id == null) openLink(href);
    else if (files().has(id)) props.onDownload?.(id);
  };

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
    <div class="notes-richedit" ref={root}>
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
      {/* Ctrl/Cmd+click follows a link; a plain click places the caret to edit it (and shows the bubble). */}
      <div ref={container} class="notes-richedit-body" onClick={event => {
        const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
        if (link && (event.ctrlKey || event.metaKey)) { event.preventDefault(); follow(link.getAttribute("href") || ""); }
      }} onMouseOver={event => {
        const id = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-attachment-id]")?.dataset.attachmentId ?? null : null;
        props.onLight?.(id);
        // A file link's tooltip sits out here, where the editor won't read it back as part of the link.
        if (id == null) container.removeAttribute("title");
        else container.title = files().has(id) ? `${files().get(id)} · Ctrl+click to download` : "This file was removed";
      }} onMouseLeave={() => { props.onLight?.(null); container.removeAttribute("title"); }}
        onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openLinkField(); } }} />
      <Show when={bubble()}>{shown =>
        // Pressing in it mustn't take the caret out of the link (which would close it).
        <div class="notes-link-bubble" style={{ top: `${shown().top}px`, left: `${shown().left}px` }} onMouseDown={event => event.preventDefault()}>
          <Show when={shown().file} fallback={<>
            <span class="notes-link-href" title={shown().href}>{shown().href.replace(/^(https?:\/\/|mailto:)/i, "")}</span>
            <button type="button" class="text-button" onClick={() => openLink(shown().href)}>Open</button>
            <button type="button" class="text-button" onClick={openLinkField}>Edit</button>
          </>}>{file => <Show when={file().name != null} fallback={<span class="notes-link-gone">File removed</span>}>
            <span class="notes-link-file" title={file().name!}>📎 {file().name}</span>
            <button type="button" class="text-button" onClick={() => props.onDownload?.(file().id)}>Download</button>
          </Show>}</Show>
          <button type="button" class="text-button" onClick={unlink}>Unlink</button>
        </div>}
      </Show>
    </div>
  );
}
