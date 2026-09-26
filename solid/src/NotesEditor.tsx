import { createSignal, onCleanup, onMount } from "solid-js";
import { Editor } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import { createNotesExtensions } from "./notes-markdown";

// Lets the item form insert attachment links and keep a hidden field in sync.
export type NotesEditorApi = {
  insertMarkdown(markdown: string): void;
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
  canSink: false,
  canLift: false,
};

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
      canSink: editor.can().sinkListItem("listItem") || editor.can().sinkListItem("taskItem"),
      canLift: editor.can().liftListItem("listItem") || editor.can().liftListItem("taskItem"),
    });
  };

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
      onUpdate: () => {
        if (!editor) return;
        // Blank trailing paragraphs serialize as &nbsp;; notes don't need them.
        props.onChange(editor.getMarkdown().replace(/(?:&nbsp;|[\s ])+$/g, ""));
      },
      onTransaction: refresh,
    });
    refresh();
    props.onEditor?.({
      insertMarkdown: (markdown) => {
        editor?.chain().focus().insertContent(markdown, { contentType: "markdown" }).run();
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
        <button type="button" class="notes-format-button" aria-label="Quote block" title="Quote block (Ctrl+Shift+B)" aria-pressed={state().blockquote} onMouseDown={event => event.preventDefault()} onClick={() => run(e => { e.chain().focus().toggleBlockquote().run(); })}>❞</button>
      </div>
      <div ref={container} class="notes-richedit-body" />
    </div>
  );
}
