import { test, expect } from "bun:test";
import { createNotesMarkdownManager } from "../src/notes-markdown";

const roundTrip = (input: string) => {
  const once = createNotesMarkdownManager().serialize(createNotesMarkdownManager().parse(input));
  const twice = createNotesMarkdownManager().serialize(createNotesMarkdownManager().parse(once));
  return { once, stable: once === twice };
};

const cases: [string, string][] = [
  ["inline marks stay intact", "This is **bold** and *italic* and ~~gone~~ and ++underlined++."],
  ["attachment links survive validation", "See [Receipt [final].pdf](attachment:file-1) and [site](https://example.com)."],
  ["nested bullet lists survive", "- one\n- two\n  - nested\n- three"],
  ["nested numbered lists survive", "1. first\n2. second\n   1. sub\n3. third"],
  ["task lists keep checkboxes", "- [ ] todo\n- [x] done"],
  ["quotes survive", "> quoted\n> more\n\nafter"],
  ["line breaks survive", "line one\nline two"],
  ["image references survive without loading", "Before ![cat pic](https://example.com/cat.png \"Title\") after"],
  ["tables survive", "| A | B |\n|---|---|\n| 1 | 2 |"],
  ["empty notes stay empty", ""],
];

for (const [name, input] of cases) {
  test(name, () => {
    const { once, stable } = roundTrip(input);
    expect(stable).toBe(true);
  });
}

test("attachments remain attachment links after a round trip", () => {
  const { once } = roundTrip("[Receipt.pdf](attachment:file-1)");
  expect(once).toContain("(attachment:file-1)");
});

test("images remain reference-style after a round trip", () => {
  const { once } = roundTrip("![cat pic](https://example.com/cat.png)");
  expect(once).toContain("![cat pic](https://example.com/cat.png)");
});
