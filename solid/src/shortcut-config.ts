export type ShortcutAction = "edit" | "complete" | "sleepTomorrow" | "sleepIndefinite" | "customSleep";
export type Shortcuts = Record<ShortcutAction, string>;

export const SHORTCUT_STORAGE_KEY = "calendar.keyboardShortcuts";
export const DEFAULT_SHORTCUTS: Shortcuts = {
  edit: "Enter",
  complete: " ",
  sleepTomorrow: "s",
  sleepIndefinite: "h",
  customSleep: "c",
};

export const labels: Record<ShortcutAction, string> = {
  edit: "Edit focused task",
  complete: "Complete task",
  sleepTomorrow: "Sleep until tomorrow",
  sleepIndefinite: "Sleep indefinitely",
  customSleep: "Custom sleep",
};

export const actions = Object.keys(labels) as ShortcutAction[];

function normalizeStoredKey(value: unknown, fallback: string) {
  if (value === "") return "";
  if (value === "Enter") return "Enter";
  if (value === " " || (typeof value === "string" && value.length === 1)) return value.toLowerCase();
  return fallback;
}

export function loadShortcuts(): Shortcuts {
  try {
    const stored = JSON.parse(localStorage.getItem(SHORTCUT_STORAGE_KEY) || "null");
    return {
      edit: normalizeStoredKey(stored?.edit, DEFAULT_SHORTCUTS.edit),
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
  return `${labels[action]}${key ? ` (${keyLabel(key)})` : ""}`;
}

export function actionForKey(key: string, shortcuts: Shortcuts): ShortcutAction | null {
  return actions.find((action) => shortcuts[action] && shortcuts[action] === key) || null;
}

