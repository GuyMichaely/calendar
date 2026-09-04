<script lang="ts">
  import { shortcutTooltip, type Shortcuts } from "./shortcuts";

  type Action = "sleepTomorrow" | "sleepIndefinite" | "customSleep";
  type Props = { action: Action; shortcuts: Shortcuts; onclick: () => void };
  let { action, shortcuts, onclick }: Props = $props();
  let title = $derived(shortcutTooltip(action, shortcuts));
</script>

<button type="button" class="task-action-icon" {title} aria-label={title} {onclick}>
  {#if action === "sleepTomorrow"}
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12.5" r="6.2" />
      <path d="M6.4 9.1h11.2" />
      <path d="M7.3 8.9c1.1-3.2 3.8-5.3 7.1-5.3 1.2 0 2.2.2 3.1.7l-2.2 4.6" />
      <circle cx="18.2" cy="4.4" r="1.25" />
      <path d="M8.4 12c.7.7 1.4.7 2.1 0M13.5 12c.7.7 1.4.7 2.1 0" />
      <path d="M9.3 15.1c1.8 1.1 3.6 1.1 5.4 0" />
    </svg>
  {:else if action === "sleepIndefinite"}
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="7" cy="7" r="2.4" />
      <circle cx="17" cy="7" r="2.4" />
      <path d="M5.2 10.4C5.2 6.8 8.2 4.2 12 4.2s6.8 2.6 6.8 6.2v2.1c0 4-3 7.1-6.8 7.1s-6.8-3.1-6.8-7.1v-2.1Z" />
      <circle cx="9.2" cy="11.5" r=".7" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="11.5" r=".7" fill="currentColor" stroke="none" />
      <path d="M10.4 14.1c1.1.9 2.1.9 3.2 0" />
      <path d="M11 13.1h2" />
    </svg>
  {:else}
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M10.7 4.1a7.2 7.2 0 1 0 5.1 12.4A6.4 6.4 0 0 1 10.7 4.1Z" />
      <circle cx="16.8" cy="16.8" r="4.2" />
      <path d="M16.8 14.7v2.4l1.6 1" />
    </svg>
  {/if}
</button>
