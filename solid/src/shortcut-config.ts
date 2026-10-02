export type ShortcutAction = "edit" | "complete" | "pushDown" | "pushDownTomorrow" | "notYet" | "addTask";
export type Shortcuts = Record<ShortcutAction, string>;

export const SHORTCUT_STORAGE_KEY = "calendar.keyboardShortcuts";
export const DEFAULT_SHORTCUTS: Shortcuts = {
  edit: "Enter",
  complete: " ",
  pushDown: "h",
  pushDownTomorrow: "s",
  notYet: "n",
  addTask: "a",
};

export const labels: Record<ShortcutAction, string> = {
  edit: "Open task details",
  complete: "Complete or reopen task",
  pushDown: "Push down or lift back up",
  pushDownTomorrow: "Push down until tomorrow",
  notYet: "Not yet (check-ins)",
  addTask: "Add a task",
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
    const stored = JSON.parse(localStorage.getItem(SHORTCUT_STORAGE_KEY) || "null") || {};
    return Object.fromEntries(actions.map(action => [action, normalizeStoredKey(stored[action], DEFAULT_SHORTCUTS[action])])) as Shortcuts;
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

