import { test, expect } from "bun:test";
import { renderNotes, attachmentMarkdown } from "../src/markdown";

test("Markdown formats notes and creates attachment download links", () => {
  const html = renderNotes("**Important**\n\n" + attachmentMarkdown("file-1", "Receipt [final].pdf"));
  expect(html).toContain("<strong>Important</strong>");
  expect(html).toContain('data-attachment-id="file-1"');
  expect(html).toContain("Receipt [final].pdf");
});
test("the editor's ++underline++ renders as underline without enabling raw HTML", () => {
  const html = renderNotes("++Important++ and <u>raw</u>");
  expect(html).toContain("<u>Important</u>");
  expect(html).not.toContain("<u>raw</u>");
});
test("notes cannot execute imported HTML or unsafe links", () => {
  const html = renderNotes('<script>alert(1)</script>\n[x](javascript:alert(1))\n[x](data:text/html,hi)\n![tracking](https://example.com/pixel)');
  expect(html).not.toContain("<script>");
  expect(html).not.toContain('href="javascript:');
  expect(html).not.toContain('href="data:');
  expect(html).not.toContain("<img");
});
test("attachment IDs and filenames cannot inject HTML attributes", () => {
  const html = renderNotes(attachmentMarkdown('file" onclick="evil', '<img src=x onerror=evil>'));
  expect(html).not.toContain("<img");
  expect(html).not.toContain(' onclick="');
});
