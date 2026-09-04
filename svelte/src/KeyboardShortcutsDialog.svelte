<script lang="ts">
  import DialogShell from "./DialogShell.svelte";
  import {
    DEFAULT_SHORTCUTS, SHORTCUT_STORAGE_KEY, keyLabel, normalizeEventKey, shortcutLabels,
    type ShortcutAction, type Shortcuts,
  } from "./shortcuts";

  type Props = { shortcuts: Shortcuts; onClose: () => void; onSave: (shortcuts: Shortcuts) => void };
  let { shortcuts, onClose, onSave }: Props = $props();
  let draft = $state<Shortcuts>({ ...shortcuts });
  let error = $state("");
  let dirty = $derived((Object.keys(draft) as ShortcutAction[]).some((action) => draft[action] !== shortcuts[action]));

  function close() {
    if (dirty && !window.confirm("Discard your unsaved changes?")) return;
    onClose();
  }

  function capture(action: ShortcutAction, event: KeyboardEvent) {
    if (event.key === "Tab" || event.key === "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    error = "";
    if (event.key === "Backspace" || event.key === "Delete") { draft[action] = ""; return; }
    if (event.ctrlKey || event.metaKey || event.altKey || (event.key !== " " && event.key.length !== 1)) {
      error = "Use a single printable key or Space.";
      return;
    }
    draft[action] = normalizeEventKey(event);
  }

  function save() {
    const used = new Set<string>();
    for (const action of Object.keys(draft) as ShortcutAction[]) {
      const key = draft[action];
      if (!key) continue;
      if (used.has(key)) { error = `${keyLabel(key)} is assigned to more than one action.`; return; }
      used.add(key);
    }
    localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(draft));
    onSave({ ...draft });
  }
</script>

<DialogShell labelledBy="shortcut-title" className="shortcut-dialog" onClose={close}>
  <div class="dialog-header">
    <h2 id="shortcut-title">Keyboard shortcuts</h2>
    <button type="button" class="icon-button" aria-label="Close" onclick={close}>×</button>
  </div>
  <p class="shortcut-help">Task hotkeys apply when the task card itself is focused. ↑/↓ moves between visible tasks; Tab moves through the focused card's controls.</p>
  <div class="shortcut-grid">
    {#each Object.keys(shortcutLabels) as action, index}
      <label class="shortcut-row">
        <span>{shortcutLabels[action as ShortcutAction]}</span>
        <input class="shortcut-key-input" readonly data-autofocus={index === 0 ? "true" : undefined} aria-label={`${shortcutLabels[action as ShortcutAction]} shortcut`} value={keyLabel(draft[action as ShortcutAction])} onkeydown={(event) => capture(action as ShortcutAction, event)} />
      </label>
    {/each}
  </div>
  <p class="shortcut-help">Press a printable key or Space while a shortcut field is focused. Backspace or Delete clears it.</p>
  <p class="shortcut-error" role="alert">{error}</p>
  <div class="dialog-actions">
    <button type="button" class="secondary-button" onclick={() => { draft = { ...DEFAULT_SHORTCUTS }; error = ""; }}>Restore defaults</button>
    <div class="spacer"></div>
    <button type="button" class="secondary-button" onclick={close}>Cancel</button>
    <button type="button" class="primary-button" onclick={save}>Save</button>
  </div>
</DialogShell>
