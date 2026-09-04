import { useState } from "preact/hooks";
import { DialogShell } from "./DialogShell";

export type ShortcutAction = "complete" | "sleepTomorrow" | "sleepIndefinite" | "customSleep";
export type Shortcuts = Record<ShortcutAction, string>;

export const SHORTCUT_STORAGE_KEY = "calendar.keyboardShortcuts";
export const DEFAULT_SHORTCUTS: Shortcuts = {
  complete: " ",
  sleepTomorrow: "s",
  sleepIndefinite: "h",
  customSleep: "c",
};

const labels: Record<ShortcutAction, string> = {
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
  const label = labels[action];
  return `${label}${key ? ` (${keyLabel(key)})` : ""}`;
}

export function actionForKey(key: string, shortcuts: Shortcuts): ShortcutAction | null {
  return (Object.keys(shortcuts) as ShortcutAction[]).find((action) => shortcuts[action] && shortcuts[action] === key) || null;
}

export function KeyboardShortcutsDialog(props: {
  shortcuts: Shortcuts;
  onClose: () => void;
  onSave: (shortcuts: Shortcuts) => void;
}) {
  const [draft, setDraft] = useState<Shortcuts>({ ...props.shortcuts });
  const [error, setError] = useState("");
  const dirty = (Object.keys(draft) as ShortcutAction[]).some((action) => draft[action] !== props.shortcuts[action]);

  const close = () => {
    if (dirty && !window.confirm("Discard your unsaved changes?")) return;
    props.onClose();
  };

  const capture = (action: ShortcutAction, event: KeyboardEvent) => {
    if (event.key === "Tab" || event.key === "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    setError("");

    if (event.key === "Backspace" || event.key === "Delete") {
      setDraft((current) => ({ ...current, [action]: "" }));
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || (event.key !== " " && event.key.length !== 1)) {
      setError("Use a single printable key or Space.");
      return;
    }
    setDraft((current) => ({ ...current, [action]: normalizeEventKey(event) }));
  };

  const save = () => {
    const used = new Set<string>();
    for (const action of Object.keys(draft) as ShortcutAction[]) {
      const key = draft[action];
      if (!key) continue;
      if (used.has(key)) {
        setError(`${keyLabel(key)} is assigned to more than one action.`);
        return;
      }
      used.add(key);
    }
    localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(draft));
    props.onSave(draft);
  };

  return (
    <DialogShell labelledBy="shortcut-title" className="shortcut-dialog" onClose={close}>
      <div class="dialog-header">
        <h2 id="shortcut-title">Keyboard shortcuts</h2>
        <button type="button" class="icon-button" aria-label="Close" onClick={close}>×</button>
      </div>
      <p class="shortcut-help">Task hotkeys apply when the task card itself is focused. ↑/↓ moves between visible tasks; Tab moves through the focused card's controls.</p>
      <div class="shortcut-grid">
        {(Object.keys(labels) as ShortcutAction[]).map((action) => (
          <label class="shortcut-row" key={action}>
            <span>{labels[action]}</span>
            <input
              class="shortcut-key-input"
              readOnly
              autoFocus={action === "complete"}
              aria-label={`${labels[action]} shortcut`}
              value={keyLabel(draft[action])}
              onKeyDown={(event) => capture(action, event as unknown as KeyboardEvent)}
            />
          </label>
        ))}
      </div>
      <p class="shortcut-help">Press a printable key or Space while a shortcut field is focused. Backspace or Delete clears it.</p>
      <p class="shortcut-error" role="alert">{error}</p>
      <div class="dialog-actions">
        <button type="button" class="secondary-button" onClick={() => { setDraft({ ...DEFAULT_SHORTCUTS }); setError(""); }}>Restore defaults</button>
        <div class="spacer" />
        <button type="button" class="secondary-button" onClick={close}>Cancel</button>
        <button type="button" class="primary-button" onClick={save}>Save</button>
      </div>
    </DialogShell>
  );
}

function SleepTomorrowIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12.5" r="6.2" /><path d="M6.4 9.1h11.2" /><path d="M7.3 8.9c1.1-3.2 3.8-5.3 7.1-5.3 1.2 0 2.2.2 3.1.7l-2.2 4.6" /><circle cx="18.2" cy="4.4" r="1.25" /><path d="M8.4 12c.7.7 1.4.7 2.1 0M13.5 12c.7.7 1.4.7 2.1 0" /><path d="M9.3 15.1c1.8 1.1 3.6 1.1 5.4 0" /></svg>;
}

function SleepIndefiniteIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="7" cy="7" r="2.4" /><circle cx="17" cy="7" r="2.4" /><path d="M5.2 10.4C5.2 6.8 8.2 4.2 12 4.2s6.8 2.6 6.8 6.2v2.1c0 4-3 7.1-6.8 7.1s-6.8-3.1-6.8-7.1v-2.1Z" /><circle cx="9.2" cy="11.5" r=".7" fill="currentColor" stroke="none" /><circle cx="14.8" cy="11.5" r=".7" fill="currentColor" stroke="none" /><path d="M10.4 14.1c1.1.9 2.1.9 3.2 0" /><path d="M11 13.1h2" /></svg>;
}

function CustomSleepIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10.7 4.1a7.2 7.2 0 1 0 5.1 12.4A6.4 6.4 0 0 1 10.7 4.1Z" /><circle cx="16.8" cy="16.8" r="4.2" /><path d="M16.8 14.7v2.4l1.6 1" /></svg>;
}

export function TaskActionIcon(props: {
  action: "sleepTomorrow" | "sleepIndefinite" | "customSleep";
  shortcuts: Shortcuts;
  onClick: () => void;
}) {
  const title = shortcutTooltip(props.action, props.shortcuts);
  return (
    <button type="button" class="task-action-icon" title={title} aria-label={title} onClick={props.onClick}>
      {props.action === "sleepTomorrow" ? <SleepTomorrowIcon /> : props.action === "sleepIndefinite" ? <SleepIndefiniteIcon /> : <CustomSleepIcon />}
    </button>
  );
}
