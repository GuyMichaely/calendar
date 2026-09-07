import { renderNotes } from "./markdown";
import type { Attachment } from "./types";

export function MarkdownNotes(props: { text: string; attachments: Attachment[]; onDownload: (attachment: Attachment) => void; onError?: (message: string) => void }) {
  return <div class="markdown-notes" innerHTML={renderNotes(props.text)} onClick={(event) => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[data-attachment-id]") : null;
    if (!link) return;
    event.preventDefault();
    let id = link.dataset.attachmentId || "";
    try { id = decodeURIComponent(id); } catch { /* Treat malformed IDs as missing. */ }
    const attachment = props.attachments.find((file) => file.id === id);
    if (attachment) props.onDownload(attachment);
    else props.onError?.("This attachment has been removed from the item.");
  }} />;
}
