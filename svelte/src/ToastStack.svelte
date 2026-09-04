<script lang="ts">
  import ToastItem from "./ToastItem.svelte";
  import type { ToastMessage } from "./toast-types";
  type Props = { toasts: ToastMessage[]; onDismiss: (id: number) => void };
  let { toasts, onDismiss }: Props = $props();
</script>

{#if toasts.length}
  <div class="toast-stack" aria-live="polite" aria-relevant="additions">
    {#each toasts as toast (toast.id)}
      <ToastItem {toast} {onDismiss} />
    {/each}
  </div>
{/if}
