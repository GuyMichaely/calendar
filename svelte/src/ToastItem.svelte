<script lang="ts">
  import { onMount } from "svelte";
  import type { ToastMessage } from "./toast-types";

  type Props = { toast: ToastMessage; onDismiss: (id: number) => void };
  let { toast, onDismiss }: Props = $props();
  let leaving = $state(false);

  function dismiss() {
    if (leaving) return;
    leaving = true;
    window.setTimeout(() => onDismiss(toast.id), 140);
  }

  onMount(() => {
    const timer = window.setTimeout(dismiss, 2600);
    return () => window.clearTimeout(timer);
  });
</script>

<button
  type="button"
  class={`queued-toast show${leaving ? " leaving" : ""}`}
  title="Dismiss"
  onclick={dismiss}
>
  {toast.message}
</button>
