import { createPortal } from "preact/compat";
import { useEffect, useState } from "preact/hooks";
import { App } from "./App";
import {
  actionForKey,
  KeyboardShortcutsDialog,
  loadShortcuts,
  normalizeEventKey,
  type Shortcuts,
} from "./shortcuts";

function isEditableTarget(target: EventTarget | null) {
  return target instanceof Element && !!target.closest("input, textarea, select, [contenteditable='true']");
}

function visibleTaskCards() {
  return [...document.querySelectorAll<HTMLElement>('[data-task-card="true"]')].filter((card) => {
    if (card.closest("details:not([open])")) return false;
    return card.getClientRects().length > 0;
  });
}

function findActionButton(card: Element, label: string) {
  return [...card.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === label) || null;
}

function runTaskAction(card: Element, action: ReturnType<typeof actionForKey>) {
  if (!action) return;
  if (action === "complete") {
    card.querySelector<HTMLButtonElement>(".complete-button")?.click();
    return;
  }
  if (action === "sleepTomorrow") {
    findActionButton(card, "Sleep until tomorrow")?.click();
    return;
  }
  if (action === "customSleep") {
    findActionButton(card, "Sleep until…")?.click();
    return;
  }
  const custom = findActionButton(card, "Sleep until…");
  if (!custom) return;
  custom.click();
  requestAnimationFrame(() => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>(".sleep-dialog button")];
    buttons.find((button) => button.textContent?.trim() === "Sleep indefinitely")?.click();
  });
}

export function FrameworkApp() {
  const [shortcuts, setShortcuts] = useState<Shortcuts>(loadShortcuts);
  const [showShortcutDialog, setShowShortcutDialog] = useState(false);
  const [menuTarget, setMenuTarget] = useState<Element | null>(null);

  useEffect(() => {
    setMenuTarget(document.querySelector(".framework-menu-panel"));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector(".framework-dialog-backdrop")) return;
      if (isEditableTarget(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const active = document.activeElement;
      const activeCard = active instanceof Element ? active.closest<HTMLElement>('[data-task-card="true"]') : null;

      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !activeCard && (active === document.body || active === document.documentElement)) {
        const cards = visibleTaskCards();
        if (!cards.length) return;
        event.preventDefault();
        (event.key === "ArrowDown" ? cards[0] : cards[cards.length - 1]).focus();
        return;
      }

      if (!activeCard || active !== activeCard || event.repeat) return;
      const action = actionForKey(normalizeEventKey(event), shortcuts);
      if (!action) return;
      event.preventDefault();
      runTaskAction(activeCard, action);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shortcuts]);

  return (
    <>
      <App />
      {menuTarget ? createPortal(
        <button
          type="button"
          class="text-button"
          onClick={() => {
            const menu = document.querySelector<HTMLDetailsElement>(".framework-menu");
            if (menu) menu.open = false;
            setShowShortcutDialog(true);
          }}
        >
          Keyboard shortcuts…
        </button>,
        menuTarget,
      ) : null}
      {showShortcutDialog ? (
        <KeyboardShortcutsDialog
          shortcuts={shortcuts}
          onClose={() => setShowShortcutDialog(false)}
          onSave={(next) => {
            setShortcuts(next);
            setShowShortcutDialog(false);
          }}
        />
      ) : null}
    </>
  );
}
