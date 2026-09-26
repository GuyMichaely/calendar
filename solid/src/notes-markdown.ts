import { Extension, Node, flattenExtensions, type Extensions, type JSONContent } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
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

export function createNotesExtensions(): Extensions {
  return [
    StarterKit.configure({
      link: {
        // Never follow links from the editor. The attachment scheme is
        // internal; everything else uses the editor's default validation.
        openOnClick: false,
        isAllowedUri: (url, ctx) => /^attachment:/i.test(url) || ctx.defaultValidate(url),
      },
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
