import type { JSX } from "solid-js";
import { onCleanup, onMount } from "solid-js";

export function DialogShell(props: {
  labelledBy: string;
  className?: string;
  onClose: () => void;
  children: JSX.Element;
}) {
  let dialogRef!: HTMLDivElement;
  let previous: HTMLElement | null = null;

  onMount(() => {
    previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initial = dialogRef.querySelector<HTMLElement>(
      "[autofocus], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])",
    );
    initial?.focus();
  });
  onCleanup(() => previous?.focus());

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...dialogRef.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
    )].filter((element) => element.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div class="solid-dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) props.onClose();
    }}>
      <div
        ref={(element) => { dialogRef = element; }}
        class={`editor-dialog${props.className ? ` ${props.className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={props.labelledBy}
        onKeyDown={onKeyDown}
      >
        {props.children}
      </div>
    </div>
  );
}
