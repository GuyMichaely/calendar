import { test, expect } from "bun:test";
import { actionForKey, DEFAULT_SHORTCUTS } from "../src/shortcut-config";

test("editing is configurable, clearable, and supports Enter reassignment", () => {
  expect(actionForKey("Enter", DEFAULT_SHORTCUTS)).toBe("edit");
  const custom = { ...DEFAULT_SHORTCUTS, edit: "e", complete: "Enter" };
  expect(actionForKey("e", custom)).toBe("edit");
  expect(actionForKey("Enter", custom)).toBe("complete");
  expect(actionForKey("Enter", { ...DEFAULT_SHORTCUTS, edit: "" })).toBeNull();
});
