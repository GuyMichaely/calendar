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
// The notes editor writes ++underline++ (CriticMarkup-style) because underline
// has no native markdown syntax. Render just that, without enabling raw HTML.
const PLUS = 0x2b;
markdown.inline.ruler.before("emphasis", "underline", (state, silent) => {
  if (silent) return false;
  if (state.src.charCodeAt(state.pos) !== PLUS) return false;
  const scanned = state.scanDelims(state.pos, true);
  let len = scanned.length;
  if (len < 2) return false;
  if (len % 2) {
    state.push("text", "", 0).content = "+";
    len--;
  }
  for (let i = 0; i < len; i += 2) {
    state.push("text", "", 0).content = "++";
    state.delimiters.push({ marker: PLUS, length: 0, token: state.tokens.length - 1, end: -1, open: scanned.can_open, close: scanned.can_close });
  }
  state.pos += scanned.length;
  return true;
});
markdown.inline.ruler2.before("emphasis", "underline", state => {
  const pair = (delimiters: typeof state.delimiters) => {
    const loneMarkers: number[] = [];
    for (let i = 0; i < delimiters.length; i++) {
      const startDelim = delimiters[i];
      if (startDelim.marker !== PLUS || startDelim.end === -1) continue;
      const endDelim = delimiters[startDelim.end];
      Object.assign(state.tokens[startDelim.token], { type: "underline_open", tag: "u", nesting: 1, markup: "++", content: "" });
      Object.assign(state.tokens[endDelim.token], { type: "underline_close", tag: "u", nesting: -1, markup: "++", content: "" });
      if (state.tokens[endDelim.token - 1]?.content === "+") loneMarkers.push(endDelim.token - 1);
    }
    while (loneMarkers.length) {
      const i = loneMarkers.pop() as number;
      let j = i + 1;
      while (j < state.tokens.length && state.tokens[j].type === "underline_close") j++;
      j--;
      if (i === j) continue;
      const token = state.tokens[j];
      state.tokens[j] = state.tokens[i];
      state.tokens[i] = token;
    }
  };
  pair(state.delimiters);
  for (const meta of state.tokens_meta) {
    if (meta?.delimiters) pair(meta.delimiters);
  }
});
export function renderNotes(value: string) { return markdown.render(value); }
export function attachmentMarkdown(id: string, name: string) {
  return `[${name.replace(/[\\[\]]/g, "\\$&")}](attachment:${encodeURIComponent(id)})`;
}
