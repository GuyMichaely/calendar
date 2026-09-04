export type ShortcutAction = "complete" | "sleepTomorrow" | "sleepIndefinite" | "customSleep";
export type Shortcuts = Record<ShortcutAction, string>;

export const SHORTCUT_STORAGE_KEY = "calendar.keyboardShortcuts";
export const DEFAULT_SHORTCUTS: Shortcuts = {
  complete: " ",
  sleepTomorrow: "s",
  sleepIndefinite: "h",
  customSleep: "c",
};

export const shortcutLabels: Record<ShortcutAction, string> = {
  complete: "Complete task",
  sleepTomorrow: "Sleep until tomorrow",
  sleepIndefinite: "Sleep indefinitely",
  customSleep: "Custom sleep",
};

function normalizeStoredKey(value: unknown, fallback: string) {
  if (value === "") return "";
  if (value === " " || (typeof value === "string" && value.length === 1)) return value.toLowerCase();
  return fallback;
}

export function loadShortcuts(): Shortcuts {
  try {
    const stored = JSON.parse(localStorage.getItem(SHORTCUT_STORAGE_KEY) || "null");
    return {
      complete: normalizeStoredKey(stored?.complete, DEFAULT_SHORTCUTS.complete),
      sleepTomorrow: normalizeStoredKey(stored?.sleepTomorrow, DEFAULT_SHORTCUTS.sleepTomorrow),
      sleepIndefinite: normalizeStoredKey(stored?.sleepIndefinite, DEFAULT_SHORTCUTS.sleepIndefinite),
      customSleep: normalizeStoredKey(stored?.customSleep, DEFAULT_SHORTCUTS.customSleep),
    };
  } catch {
    return { ...DEFAULT_SHORTCUTS };
  }
}

export function normalizeEventKey(event: KeyboardEvent) {
  if (event.key === " ") return " ";
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

export function keyLabel(key: string) {
  if (!key) return "Unassigned";
  if (key === " ") return "Space";
  return key.length === 1 ? key.toUpperCase() : key;
}

export function shortcutTooltip(action: ShortcutAction, shortcuts: Shortcuts) {
  const key = shortcuts[action];
  return `${shortcutLabels[action]}${key ? ` (${keyLabel(key)})` : ""}`;
}

export function actionForKey(key: string, shortcuts: Shortcuts): ShortcutAction | null {
  return (Object.keys(shortcuts) as ShortcutAction[]).find((action) => shortcuts[action] && shortcuts[action] === key) || null;
}
