import { useEffect, useRef, useState } from "preact/hooks";
import { App } from "./App";
import { KeyboardShortcutsDialog, loadShortcuts, type Shortcuts } from "./shortcuts";

function visibleTaskCards() {
  return [...document.querySelectorAll<HTMLElement>('[data-task-card="true"]')].filter((card) => {
    if (card.closest("details:not([open])")) return false;
    return card.getClientRects().length > 0;
  });
}

export function FrameworkApp() {
  const [shortcuts, setShortcuts] = useState<Shortcuts>(loadShortcuts);
  const [showShortcutDialog, setShowShortcutDialog] = useState(false);
  const shortcutReturnTask = useRef<HTMLElement | null>(null);
  const [, setClockTick] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!document.querySelector(".framework-dialog-backdrop")) setClockTick((value) => value + 1);
    }, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (document.querySelector(".framework-dialog-backdrop")) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const active = document.activeElement;
      if (active !== document.body && active !== document.documentElement) return;
      const cards = visibleTaskCards();
      if (!cards.length) return;
      event.preventDefault();
      (event.key === "ArrowDown" ? cards[0] : cards[cards.length - 1]).focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const openShortcuts = () => {
    shortcutReturnTask.current = document.querySelector<HTMLElement>('[data-task-card="true"][tabindex="0"]');
    setShowShortcutDialog(true);
  };

  const closeShortcuts = () => {
    setShowShortcutDialog(false);
    const task = shortcutReturnTask.current;
    shortcutReturnTask.current = null;
    if (task?.isConnected) requestAnimationFrame(() => task.focus());
  };

  return (
    <>
      <App shortcuts={shortcuts} onOpenShortcuts={openShortcuts} />
      {showShortcutDialog ? (
        <KeyboardShortcutsDialog
          shortcuts={shortcuts}
          onClose={closeShortcuts}
          onSave={(next) => {
            setShortcuts(next);
            closeShortcuts();
          }}
        />
      ) : null}
    </>
  );
}
