import { useEffect, useState } from "preact/hooks";
import { App } from "./App";
import { KeyboardShortcutsDialog, loadShortcuts, type Shortcuts } from "./shortcuts";

export function FrameworkApp() {
  const [shortcuts, setShortcuts] = useState<Shortcuts>(loadShortcuts);
  const [showShortcutDialog, setShowShortcutDialog] = useState(false);
  const [, setClockTick] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!document.querySelector(".framework-dialog-backdrop")) setClockTick((value) => value + 1);
    }, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <>
      <App shortcuts={shortcuts} onOpenShortcuts={() => setShowShortcutDialog(true)} />
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
