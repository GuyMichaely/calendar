import { For, Show, createSignal, onCleanup, onMount } from "solid-js";

export type ToastMessage = {
  id: number;
  message: string;
};

function ToastItem(props: { toast: ToastMessage; onDismiss: (id: number) => void }) {
  const [leaving, setLeaving] = createSignal(false);
  let removalTimer: number | undefined;

  const dismiss = () => {
    if (leaving()) return;
    setLeaving(true);
    removalTimer = window.setTimeout(() => props.onDismiss(props.toast.id), 140);
  };

  let lifetimeTimer: number | undefined;
  onMount(() => {
    lifetimeTimer = window.setTimeout(dismiss, 2600);
  });
  onCleanup(() => {
    if (lifetimeTimer !== undefined) window.clearTimeout(lifetimeTimer);
    if (removalTimer !== undefined) window.clearTimeout(removalTimer);
  });

  return (
    <button
      type="button"
      class={`queued-toast show${leaving() ? " leaving" : ""}`}
      title="Dismiss"
      onClick={dismiss}
    >
      {props.toast.message}
    </button>
  );
}

export function ToastStack(props: { toasts: ToastMessage[]; onDismiss: (id: number) => void }) {
  return (
    <Show when={props.toasts.length}>
      <div class="toast-stack" aria-live="polite" aria-relevant="additions">
        <For each={props.toasts}>{(toast) => <ToastItem toast={toast} onDismiss={props.onDismiss} />}</For>
      </div>
    </Show>
  );
}
