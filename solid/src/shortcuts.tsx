import { For, createMemo, createSignal, createEffect, onCleanup } from "solid-js";

import { actions, labels, DEFAULT_SHORTCUTS, SHORTCUT_STORAGE_KEY, normalizeEventKey, keyLabel, type ShortcutAction, type Shortcuts } from "./shortcut-config";
export * from "./shortcut-config";

export function KeyboardShortcutSettings(props: {
  shortcuts: Shortcuts;
  onClose: () => void;
  onSave: (shortcuts: Shortcuts) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = createSignal<Shortcuts>({ ...props.shortcuts });
  const [error, setError] = createSignal("");
  const dirty = createMemo(() => actions.some((action) => draft()[action] !== props.shortcuts[action]));

  createEffect(() => props.onDirtyChange(dirty()));
  onCleanup(() => props.onDirtyChange(false));
  const close = () => props.onClose();

  const capture = (action: ShortcutAction, event: KeyboardEvent) => {
    if (event.key === "Tab" || event.key === "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    setError("");

    if (event.key === "Backspace" || event.key === "Delete") {
      setDraft((current) => ({ ...current, [action]: "" }));
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || (event.key !== " " && event.key !== "Enter" && event.key.length !== 1)) {
      setError("Use a single printable key, Space, or Enter.");
      return;
    }
    setDraft((current) => ({ ...current, [action]: normalizeEventKey(event) }));
  };

  const save = () => {
    const used = new Set<string>();
    for (const action of actions) {
      const key = draft()[action];
      if (!key) continue;
      if (used.has(key)) {
        setError(`${keyLabel(key)} is assigned to more than one action.`);
        return;
      }
      used.add(key);
    }
    localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(draft()));
    props.onSave({ ...draft() });
  };

  return (
    <section class="shortcut-settings">
      <div class="dialog-header">
        <h2 id="shortcut-title">Keyboard shortcuts</h2>
      </div>
      <p class="shortcut-help">In the Agenda and Boards, these apply to the focused task (Add a task works anywhere there). ↑/↓ moves between tasks, wrapping around at the ends; in Boards, ←/→ moves between columns. Home and End go to the first and last task; Tab moves through the focused task's buttons.</p>
      <div class="shortcut-grid">
        <For each={actions}>{(action, index) => (
          <label class="shortcut-row">
            <span>{labels[action]}</span>
            <input
              class="shortcut-key-input"
              readOnly
              data-dialog-autofocus={index() === 0}
              aria-label={`${labels[action]} shortcut`}
              value={keyLabel(draft()[action])}
              onKeyDown={(event) => capture(action, event)}
            />
          </label>
        )}</For>
      </div>
      <p class="shortcut-help">Press a printable key, Space, or Enter while a shortcut field is focused. Backspace or Delete clears it.</p>
      <p class="shortcut-error" role="alert">{error()}</p>
      <div class="dialog-actions">
        <button type="button" class="secondary-button" onClick={() => { setDraft({ ...DEFAULT_SHORTCUTS }); setError(""); }}>Restore defaults</button>
        <div class="spacer" />
        <button type="button" class="secondary-button" onClick={close}>Close settings</button>
        <button type="button" class="primary-button" onClick={save}>Save</button>
      </div>
    </section>
  );
}
