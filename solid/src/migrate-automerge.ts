import {
  inspectAutomergeMigration,
  migrateLegacyCalendarData,
} from "../../migrations/2026-09-automerge-storage.js";

const status = document.querySelector<HTMLParagraphElement>("#status");
const migrateButton = document.querySelector<HTMLButtonElement>("#migrate");

if (!status || !migrateButton) throw new Error("Migration page is missing required controls.");

function show(message: string, kind: "plain" | "error" | "success" = "plain") {
  status.textContent = message;
  status.className = kind === "plain" ? "" : kind;
}

async function inspect() {
  migrateButton.disabled = true;
  try {
    const result = await inspectAutomergeMigration();
    if (result.existingItemCount > 0) {
      show(
        `Stopped: the current Automerge store already contains ${result.existingItemCount} item${result.existingItemCount === 1 ? "" : "s"}. ` +
          "Do not overwrite it. Return to Calendar and report this state before proceeding.",
        "error",
      );
      return;
    }
    show(
      `Found ${result.oldItemCount} legacy item${result.oldItemCount === 1 ? "" : "s"}. ` +
        "The current Automerge store is empty and ready for migration.",
    );
    migrateButton.disabled = result.oldItemCount === 0;
  } catch (error) {
    show(error instanceof Error ? error.message : "Could not inspect local calendar data.", "error");
  }
}

migrateButton.addEventListener("click", () => {
  migrateButton.disabled = true;
  show("Migrating local task and event data…");
  void migrateLegacyCalendarData()
    .then(({ migratedItemCount }) => {
      show(
        `Migration complete: ${migratedItemCount} item${migratedItemCount === 1 ? "" : "s"} copied to the Automerge store. ` +
          "The old database was left unchanged. Return to Calendar and verify the data before enabling remote sync.",
        "success",
      );
    })
    .catch((error: unknown) => {
      show(error instanceof Error ? error.message : "Migration failed.", "error");
      migrateButton.disabled = false;
    });
});

void inspect();
