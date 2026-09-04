<script lang="ts">
  import { isoToLocalInput, localInputToIso, sleepInfo, toDate, tomorrowMidnight } from "../../site/domain.js";
  import DialogShell from "./DialogShell.svelte";
  import type { Task } from "./types";

  type Props = { task: Task; onClose: () => void; onSave: (until: string | null) => Promise<void> };
  let { task, onClose, onSave }: Props = $props();
  const sleep = sleepInfo(task, new Date());
  const initialValue = sleep.sleeping && !sleep.indefinite ? isoToLocalInput(sleep.until) : isoToLocalInput(tomorrowMidnight(new Date()));
  let value = $state(initialValue);
  let title = $derived(String(task.title || "").replace(/[\p{Cf}\p{Cc}\s]/gu, "") ? task.title : "Untitled task");

  function close() {
    if (value !== initialValue && !window.confirm("Discard your unsaved changes?")) return;
    onClose();
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    const until = localInputToIso(value);
    if (!until || toDate(until) <= new Date()) return;
    void onSave(until);
  }
</script>

<DialogShell labelledBy="sleep-title" className="sleep-dialog" onClose={close}>
  <form onsubmit={submit}>
    <div class="dialog-header">
      <div><h2 id="sleep-title">Sleep task</h2><p class="muted">{title}</p></div>
      <button type="button" class="icon-button" aria-label="Close" onclick={close}>×</button>
    </div>
    <label class="field full"><span>Sleep until</span><input type="datetime-local" required bind:value={value} data-autofocus /></label>
    <div class="dialog-actions">
      <button type="button" class="secondary-button" onclick={() => void onSave(null)}>Sleep indefinitely</button>
      <div class="spacer"></div>
      <button type="button" class="secondary-button" onclick={close}>Cancel</button>
      <button type="submit" class="primary-button">Sleep until</button>
    </div>
  </form>
</DialogShell>
