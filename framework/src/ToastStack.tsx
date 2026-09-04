import { useEffect, useState } from "preact/hooks";

export type ToastMessage = {
  id: number;
  message: string;
};

function ToastItem(props: { toast: ToastMessage; onDismiss: (id: number) => void }) {
  const [leaving, setLeaving] = useState(false);

  const dismiss = () => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(() => props.onDismiss(props.toast.id), 140);
  };

  useEffect(() => {
    const timer = window.setTimeout(dismiss, 2600);
    return () => window.clearTimeout(timer);
  }, [props.toast.id]);

  return (
    <button
      type="button"
      class={`queued-toast show${leaving ? " leaving" : ""}`}
      title="Dismiss"
      onClick={dismiss}
    >
      {props.toast.message}
    </button>
  );
}

export function ToastStack(props: { toasts: ToastMessage[]; onDismiss: (id: number) => void }) {
  if (!props.toasts.length) return null;
  return (
    <div class="toast-stack" aria-live="polite" aria-relevant="additions">
      {props.toasts.map((toast) => <ToastItem key={toast.id} toast={toast} onDismiss={props.onDismiss} />)}
    </div>
  );
}
