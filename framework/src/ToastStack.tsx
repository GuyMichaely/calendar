import { useEffect } from "preact/hooks";

export type ToastMessage = {
  id: number;
  message: string;
};

function ToastItem(props: { toast: ToastMessage; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => props.onDismiss(props.toast.id), 2600);
    return () => window.clearTimeout(timer);
  }, [props.toast.id, props.onDismiss]);

  return (
    <button
      type="button"
      class="queued-toast show"
      title="Dismiss"
      onClick={() => props.onDismiss(props.toast.id)}
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
