import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });
// Notes never execute HTML or embed remote tracking images. Attachment links
// resolve only against files belonging to the current item.
markdown.disable("image");
markdown.validateLink = (url) => /^(https?:|mailto:|attachment:)/i.test(url);
markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  const token = tokens[index];
  const href = String(token.attrGet("href") || "");
  if (/^attachment:/i.test(href)) {
    token.attrSet("data-attachment-id", href.slice("attachment:".length));
    token.attrSet("href", "#attachment");
  } else {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noopener noreferrer");
  }
  return renderer.renderToken(tokens, index, options);
};
export function renderNotes(value: string) { return markdown.render(value); }
export function attachmentMarkdown(id: string, name: string) {
  return `[${name.replace(/[\\[\]]/g, "\\$&")}](attachment:${encodeURIComponent(id)})`;
}
