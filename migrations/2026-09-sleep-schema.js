// One-off browser migration for data created before the sleep schema.
//
// Usage:
// 1. Back up your calendar data from the app.
// 2. Open the calendar site in the browser that contains the old IndexedDB data.
// 3. Open DevTools -> Console.
// 4. Paste this entire file and run it once.
// 5. Reload the app.
//
// This file is intentionally outside site/ and is never loaded by the application.

(async () => {
  const DB_NAME = "calendar-app";
  const DB_VERSION = 1;
  const STORE = "items";

  const openDb = () =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const request = store.getAll();

  const items = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });

  const nowDate = new Date();
  const now = nowDate.toISOString();
  let changedCount = 0;

  for (const item of items) {
    if (item?.kind !== "task") continue;

    const updated = { ...item };
    const history = [...(item.history || [])];
    let changed = false;

    if (updated.state === "waiting") {
      const wake = updated.wakeAt ? new Date(updated.wakeAt) : null;
      const validWake = wake && !Number.isNaN(wake.getTime()) ? wake : null;
      const available = updated.availableFrom ? new Date(updated.availableFrom) : null;
      const validAvailable = available && !Number.isNaN(available.getTime()) ? available : null;
      const wasOldTomorrow = history.some((entry) => entry?.type === "deferred");

      updated.state = "open";

      if (validWake && wasOldTomorrow) {
        updated.sleep = { until: validWake.toISOString(), startedAt: now };
      } else if (validWake && (!validAvailable || validWake > validAvailable)) {
        updated.availableFrom = validWake.toISOString();
      }

      delete updated.wakeAt;
      changed = true;
    }

    if (Object.prototype.hasOwnProperty.call(updated, "ignoredUntil")) {
      const ignoredUntil = updated.ignoredUntil ? new Date(updated.ignoredUntil) : null;
      const validIgnoredUntil = ignoredUntil && !Number.isNaN(ignoredUntil.getTime()) ? ignoredUntil : null;

      if (!updated.sleep && validIgnoredUntil && validIgnoredUntil > nowDate) {
        updated.sleep = { until: validIgnoredUntil.toISOString(), startedAt: now };
      }

      delete updated.ignoredUntil;
      changed = true;
    }

    if (Object.prototype.hasOwnProperty.call(updated, "wakeAt")) {
      delete updated.wakeAt;
      changed = true;
    }

    if (!changed) continue;

    updated.updatedAt = now;
    store.put(updated);
    changedCount += 1;
  }

  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Migration transaction aborted"));
  });

  db.close();
  console.log(`Migration complete. Updated ${changedCount} task${changedCount === 1 ? "" : "s"}.`);
})();
