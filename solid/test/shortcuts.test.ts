import { describe, expect, test } from "vitest";
import { DEFAULT_SHORTCUTS, actionForKey, keyLabel, normalizeEventKey } from "../src/shortcuts";

describe("Solid task shortcut semantics", () => {
  test("default keys route to semantic task actions", () => {
    expect(actionForKey(" ", DEFAULT_SHORTCUTS)).toBe("complete");
    expect(actionForKey("s", DEFAULT_SHORTCUTS)).toBe("sleepTomorrow");
    expect(actionForKey("h", DEFAULT_SHORTCUTS)).toBe("sleepIndefinite");
    expect(actionForKey("c", DEFAULT_SHORTCUTS)).toBe("customSleep");
  });

  test("printable keys normalize consistently", () => {
    expect(normalizeEventKey({ key: "S" } as KeyboardEvent)).toBe("s");
    expect(normalizeEventKey({ key: " " } as KeyboardEvent)).toBe(" ");
    expect(keyLabel(" ")).toBe("Space");
  });
});
