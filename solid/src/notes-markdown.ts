import { Extension, Mark, Node, flattenExtensions, type Extensions, type JSONContent, type MarkViewRenderer } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Link } from "@tiptap/extension-link";
import type { Mark as ProseMirrorMark, Node as ProseMirrorNode, ResolvedPos } from "@tiptap/pm/model";
import { Plugin, TextSelection, type EditorState } from "@tiptap/pm/state";
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

/*
 * Typing at a link's end adds to it; typing before one starting a line doesn't (the caret there
 * carries its marks less the link, and text typed there before the caret's move has been read loses
 * the link as it goes in). A line ending in a link gets a space after it while it's edited, so past
 * the link there's somewhere to type outside it: that space isn't kept unless something follows it
 * (see withoutLinkTails). Enter at the link's end goes past the space, so the new line doesn't start
 * with it.
 */
const isLink = (mark: ProseMirrorMark) => mark.type.name === "link";
const outsideLinks = (marks: readonly ProseMirrorMark[], $pos: ResolvedPos) => marks.filter(mark => !isLink(mark) || (!!$pos.nodeBefore && mark.isInSet($pos.nodeBefore.marks)));
const endsLine = (node: ProseMirrorNode | null | undefined) => !node || node.type.name === "hardBreak";
const TAIL = "linkTail";
const isTail = (node: ProseMirrorNode | null | undefined) => !!node?.marks.some(mark => mark.type.name === TAIL);
const LinkTail = Mark.create({ name: TAIL, inclusive: false, renderHTML: () => ["span", { class: "link-tail" }, 0] });
// Each link ending a line gets its space; one something's been typed after is kept as a plain space,
// and one whose link has gone goes too.
function placeLinkTails(state: EditorState) {
  const tr = state.tr, cursor = state.selection instanceof TextSelection ? state.selection.$cursor?.pos : undefined, tail = state.schema.marks[TAIL];
  state.doc.descendants((block, pos) => {
    if (!block.inlineContent) return true;
    let offset = pos + 1;
    for (let index = 0; index < block.childCount; index++) {
      const node = block.child(index), before = index ? block.child(index - 1) : null, after = index + 1 < block.childCount ? block.child(index + 1) : null;
      const from = tr.mapping.map(offset), to = tr.mapping.map(offset + node.nodeSize);
      if (isTail(node)) {
        if (!before?.marks.some(isLink)) tr.delete(from, to);
        else if (node.text !== " " || !endsLine(after)) tr.removeMark(from, to, tail);
      } else if (node.marks.some(isLink) && endsLine(after)) {
        tr.insert(to, state.schema.text(" ", [...node.marks.filter(mark => !isLink(mark)), tail.create()]));
        // The caret that was at the link's end stays there, in it.
        if (cursor === offset + node.nodeSize) tr.setSelection(TextSelection.create(tr.doc, to));
      }
      offset += node.nodeSize;
    }
    return false;
  });
  return tr.docChanged ? tr : null;
}
const linkEdges = new Plugin({
  appendTransaction(transactions, _, state) {
    if (transactions.some(tr => tr.docChanged)) {
      const tr = placeLinkTails(state);
      if (tr) return tr;
    }
    if (!transactions.some(tr => tr.docChanged || tr.selectionSet || tr.storedMarksSet)) return null;
    const $cursor = state.selection instanceof TextSelection ? state.selection.$cursor : null;
    if (!$cursor) return null;
    const marks = state.storedMarks ?? $cursor.marks(), kept = outsideLinks(marks, $cursor);
    return kept.length < marks.length ? state.tr.setStoredMarks(kept) : null;
  },
  props: {
    handleTextInput(view, from, to, text, deflt) {
      if (view.composing || from !== to) return false;
      const tr = deflt(), $from = view.state.doc.resolve(from);
      const edges = (tr.doc.nodeAt(from)?.marks ?? []).filter(mark => isLink(mark) && !outsideLinks([mark], $from).length);
      if (!edges.length) return false;
      for (const mark of edges) tr.removeMark(from, from + text.length, mark);
      view.dispatch(tr);
      return true;
    },
  },
});
const LinkTailKeys = Extension.create({
  name: "notesLinkTailKeys",
  priority: 1000,
  addKeyboardShortcuts() {
    const past = () => {
      const { $cursor } = this.editor.state.selection as TextSelection;
      if ($cursor && !$cursor.textOffset && isTail($cursor.nodeAfter)) this.editor.commands.setTextSelection($cursor.pos + 1);
      return false;
    };
    return { Enter: past, "Shift-Enter": past, "Mod-Enter": past };
  },
});

/** The document without the spaces kept after links that end lines while they're edited. */
export function withoutLinkTails(json: JSONContent): JSONContent {
  if (!json.content) return json;
  return { ...json, content: json.content.filter(node => !node.marks?.some(mark => mark.type === TAIL)).map(withoutLinkTails) };
}

// `linkView`: how the editor shows links (its file links), where there is one.
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
    LinkTail,
    LinkTailKeys,
  ];
}

// Headless serialization for tests and anywhere the full editor is unavailable.
export function createNotesMarkdownManager(): MarkdownManager {
  return new MarkdownManager({ markedOptions: MARKED_OPTIONS, extensions: flattenExtensions(createNotesExtensions()) });
}
