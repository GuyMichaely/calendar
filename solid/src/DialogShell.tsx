import type { JSX } from "solid-js";
import { onCleanup, onMount } from "solid-js";

export function DialogShell(props: {
  labelledBy: string;
  className?: string;
  // "dialog" focuses the panel itself, e.g. to keep a touch keyboard closed.
  initialFocus?: "content" | "dialog";
  onClose: () => void;
  children: JSX.Element;
}) {
  let dialogRef!: HTMLDivElement;
  let previous: HTMLElement | null = null;
  let previousOverflow = "";
  // The click that opened the dialog can be followed by a second one (a double-click); keep it from closing it.
  const openedAt = performance.now();

  onMount(() => {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (props.initialFocus === "dialog") { dialogRef.focus({ preventScroll: true }); return; }
    const initial = dialogRef.querySelector<HTMLElement>('[data-dialog-autofocus="true"]') || dialogRef.querySelector<HTMLElement>(
      "input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])",
    );
    initial?.focus({ preventScroll: true });
  });
  onCleanup(() => { document.body.style.overflow = previousOverflow; previous?.focus({ preventScroll: true }); });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...dialogRef.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
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
      if (event.target !== event.currentTarget) return;
      if (performance.now() - openedAt < 400) event.preventDefault();
      else props.onClose();
    }}>
      <div
        ref={(element) => { dialogRef = element; }}
        class={`editor-dialog${props.className ? ` ${props.className}` : ""}`}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={props.labelledBy}
        onKeyDown={onKeyDown}
      >
        {props.children}
      </div>
    </div>
  );
}
