import { dateKey } from "../../site/domain.js";
import { exportData, importData, redo, redoLabel, undo, undoLabel } from "../../site/storage.js";

type Refresh = () => Promise<void>;
type Toast = (message: string) => void;

export async function applyUndo(refresh: Refresh, toast: Toast) {
  const label = undoLabel();
  if (!(await undo())) return;
  await refresh();
  toast(`Undo${label ? ` ${label}` : ""}`);
}

export async function applyRedo(refresh: Refresh, toast: Toast) {
  const label = redoLabel();
  if (!(await redo())) return;
  await refresh();
  toast(`Redo${label ? ` ${label}` : ""}`);
}

export async function exportBackup() {
  const text = await exportData();
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `calendar-backup-${dateKey(new Date())}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function importBackup(file: File, refresh: Refresh, toast: Toast) {
  try {
    const count = await importData(await file.text());
    await refresh();
    toast(`Imported ${count} items`);
  } catch (error) {
    toast(error instanceof Error ? error.message : "Import failed");
  }
}
