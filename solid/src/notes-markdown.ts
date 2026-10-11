import { Extension, Node, flattenExtensions, type Extensions, type JSONContent, type MarkViewRenderer } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Link } from "@tiptap/extension-link";
import type { Mark, ResolvedPos } from "@tiptap/pm/model";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { Markdown, MarkdownManager } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import { TaskItem, TaskList } from "@tiptap/extension-list";

// Single newlines in old notes render as line breaks in the read-only view
// (markdown-it `breaks: true`), so parse them the same way here.
const MARKED_OPTIONS = { gfm: true, breaks: true };

// Ctrl+[ / Ctrl+] mirror Tab / Shift+Tab for sinking and lifting list items.
const IndentListShortcuts = Extension.create({
  name: "notesIndentListShortcuts",
  addKeyboardShortcuts() {
    return {
      "Mod-[": () => this.editor.commands.liftListItem("listItem"),
      "Mod-]": () => this.editor.commands.sinkListItem("listItem"),
    };
  },
});

// Notes never render images (the read-only view strips them to avoid remote
// loading). This atom keeps `![alt](src)` in the document so editing a note
// does not silently delete image references.
const ImageReference = Node.create({
  name: "image",
  inline: true,
  group: "inline",
  atom: true,
  addAttributes() {
    return { src: { default: "" }, alt: { default: "" }, title: { default: null as string | null } };
  },
  parseMarkdown(token: { href?: string | null; text?: string; title?: string | null }): JSONContent {
    return {
      type: "image",
      attrs: { src: token.href || "", alt: token.text || "", title: token.title ?? null },
    };
  },
  renderMarkdown(node) {
    const attrs = (node?.attrs || {}) as { src?: string; alt?: string; title?: string | null };
    const alt = String(attrs.alt || "").replace(/[[\]]/g, "\\$&");
    const title = attrs.title ? ` "${String(attrs.title).replace(/"/g, "'")}"` : "";
    return `![${alt}](${attrs.src || ""}${title})`;
  },
  renderHTML({ node }) {
    return [
      "span",
      { class: "notes-image-ref", title: String(node.attrs.src || "") },
      `Image: ${node.attrs.alt || node.attrs.src || "image"}`,
    ];
  },
});

// `linkView`: how the editor shows links (its file links), where there is one.
/*
 * Typing beside a link (after one, or before one starting a line) is plain text: it never grows the
 * link, which only grows from inside. The caret there carries its marks less the link, and text
 * typed there before the caret's move has been read loses the link as it goes in. (A link that
 * isn't inclusive would do the same, but a phone keyboard composing right after a file link's
 * paperclip, inside the link, then gets its text split and doubled.)
 */
const offEdges = (marks: readonly Mark[], $pos: ResolvedPos) => marks.filter(mark => mark.type.name !== "link" ||
  (!!$pos.nodeBefore && !!$pos.nodeAfter && mark.isInSet($pos.nodeBefore.marks) && mark.isInSet($pos.nodeAfter.marks)));
const linkEdges = new Plugin({
  appendTransaction(transactions, _, state) {
    if (!transactions.some(tr => tr.docChanged || tr.selectionSet || tr.storedMarksSet)) return null;
    const $cursor = state.selection instanceof TextSelection ? state.selection.$cursor : null;
    if (!$cursor) return null;
    const marks = state.storedMarks ?? $cursor.marks(), kept = offEdges(marks, $cursor);
    return kept.length < marks.length ? state.tr.setStoredMarks(kept) : null;
  },
  props: {
    handleTextInput(view, from, to, text, deflt) {
      if (view.composing || from !== to) return false;
      const tr = deflt(), $from = view.state.doc.resolve(from);
      const edges = (tr.doc.nodeAt(from)?.marks ?? []).filter(mark => mark.type.name === "link" && !offEdges([mark], $from).length);
      if (!edges.length) return false;
      for (const mark of edges) tr.removeMark(from, from + text.length, mark);
      view.dispatch(tr);
      return true;
    },
  },
});

export function createNotesExtensions(options: { linkView?: MarkViewRenderer } = {}): Extensions {
  return [
    StarterKit.configure({ link: false }),
    Link.extend({
      inclusive: () => true,
      addMarkView: options.linkView && (() => options.linkView!),
      addProseMirrorPlugins() { return [...(this.parent?.() ?? []), linkEdges]; },
    }).configure({
      // Never follow links from the editor. The attachment scheme is
      // internal; everything else uses the editor's default validation.
      openOnClick: false,
      isAllowedUri: (url, ctx) => /^attachment:/i.test(url) || ctx.defaultValidate(url),
    }),
    TableKit,
    TaskList,
    TaskItem,
    ImageReference,
    Markdown.configure({ markedOptions: MARKED_OPTIONS }),
    IndentListShortcuts,
  ];
}

// Headless serialization for tests and anywhere the full editor is unavailable.
export function createNotesMarkdownManager(): MarkdownManager {
  return new MarkdownManager({ markedOptions: MARKED_OPTIONS, extensions: flattenExtensions(createNotesExtensions()) });
}
