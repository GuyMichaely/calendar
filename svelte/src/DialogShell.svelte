<script lang="ts">
  import { onMount, type Snippet } from "svelte";

  type Props = {
    labelledBy: string;
    className?: string;
    onClose: () => void;
    children: Snippet;
  };

  let { labelledBy, className = "", onClose, children }: Props = $props();
  let dialog: HTMLDivElement;

  onMount(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initial = dialog.querySelector<HTMLElement>(
      "[data-autofocus], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])",
    );
    initial?.focus();
    return () => previous?.focus();
  });

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>(
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
  }
</script>

<div
  class="svelte-dialog-backdrop"
  onmousedown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}
>
  <div
    bind:this={dialog}
    class={`editor-dialog${className ? ` ${className}` : ""}`}
    role="dialog"
    aria-modal="true"
    aria-labelledby={labelledBy}
    onkeydown={handleKeyDown}
  >
    {@render children()}
  </div>
</div>
