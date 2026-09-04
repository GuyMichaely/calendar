import { canRedo, canUndo, redo, redoLabel, undo, undoLabel } from "./storage.js";

const SHORTCUT_STORAGE_KEY = "calendar.keyboardShortcuts";
const DEFAULT_SHORTCUTS = {
  complete: " ",
  sleepTomorrow: "s",
  sleepIndefinite: "h",
  customSleep: "c",
};

const TASK_ACTION_BY_SHORTCUT = {
  complete: "complete",
  sleepTomorrow: "sleep-tomorrow",
  sleepIndefinite: "sleep-indefinite",
  customSleep: "sleep-custom",
};

function normalizeStoredKey(value, fallback) {
  if (value === "") return "";
  if (value === " " || (typeof value === "string" && value.length === 1)) return value.toLowerCase();
  return fallback;
}

function loadShortcuts() {
  try {
    const stored = JSON.parse(localStorage.getItem(SHORTCUT_STORAGE_KEY) || "null");
    return {
      complete: normalizeStoredKey(stored?.complete, DEFAULT_SHORTCUTS.complete),
      sleepTomorrow: normalizeStoredKey(stored?.sleepTomorrow, DEFAULT_SHORTCUTS.sleepTomorrow),
      sleepIndefinite: normalizeStoredKey(stored?.sleepIndefinite, DEFAULT_SHORTCUTS.sleepIndefinite),
      customSleep: normalizeStoredKey(stored?.customSleep, DEFAULT_SHORTCUTS.customSleep),
    };
  } catch {
    return { ...DEFAULT_SHORTCUTS };
  }
}

function normalizeEventKey(event) {
  if (event.key === " ") return " ";
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

function keyLabel(key) {
  if (!key) return "Unassigned";
  if (key === " ") return "Space";
  return key.length === 1 ? key.toUpperCase() : key;
}

function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  return !!target.closest("input, textarea, select, [contenteditable='true']");
}

function isInteractiveTarget(target) {
  if (!(target instanceof Element)) return false;
  return !!target.closest("button, a, input, textarea, select, label, [contenteditable='true']");
}

export function createKeyboardController({ taskSections, showToast, onHistoryApplied, onTaskAction, onShortcutsChanged }) {
  let shortcuts = loadShortcuts();
  let rememberedTaskId = null;
  let rememberedTaskIndex = 0;
  let taskFocusActive = false;
  let focusSyncScheduled = false;
  let undoMenuButton = null;
  let redoMenuButton = null;

  function visibleTaskCards() {
    return [...taskSections.querySelectorAll(".task-card")].filter((card) => {
      if (card.closest("details:not([open])")) return false;
      return card.getClientRects().length > 0;
    });
  }

  function rememberCard(card) {
    const cards = visibleTaskCards();
    const index = cards.indexOf(card);
    if (index >= 0) rememberedTaskIndex = index;
    rememberedTaskId = card.dataset.id || rememberedTaskId;
    cards.forEach((candidate) => {
      candidate.tabIndex = candidate === card ? 0 : -1;
    });
  }

  function focusCard(card, { scroll = true } = {}) {
    if (!card) return;
    rememberCard(card);
    card.focus({ preventScroll: !scroll });
    if (scroll) card.scrollIntoView({ block: "nearest" });
  }

  function restoreRememberedCard() {
    if (document.querySelector("dialog[open]")) return;
    const cards = visibleTaskCards();
    if (!cards.length) return;
    const matching = rememberedTaskId ? cards.find((card) => card.dataset.id === rememberedTaskId) : null;
    focusCard(matching || cards[Math.min(rememberedTaskIndex, cards.length - 1)], { scroll: false });
  }

  function syncVisibleCardTabStops() {
    focusSyncScheduled = false;
    const cards = visibleTaskCards();
    if (!cards.length) return;

    const remembered = rememberedTaskId ? cards.find((card) => card.dataset.id === rememberedTaskId) : null;
    const roving = remembered || cards[0];
    cards.forEach((card) => {
      card.tabIndex = card === roving ? 0 : -1;
    });

    if (taskFocusActive && document.activeElement === document.body) restoreRememberedCard();
  }

  function scheduleTaskFocusSync() {
    if (focusSyncScheduled) return;
    focusSyncScheduled = true;
    requestAnimationFrame(syncVisibleCardTabStops);
  }

  function moveTaskFocus(direction, activeCard = null) {
    const cards = visibleTaskCards();
    if (!cards.length) return;
    if (!activeCard) {
      focusCard(direction > 0 ? cards[0] : cards[cards.length - 1]);
      return;
    }
    const index = cards.indexOf(activeCard);
    if (index < 0) return;
    const nextIndex = Math.max(0, Math.min(cards.length - 1, index + direction));
    focusCard(cards[nextIndex]);
  }

  function getShortcutHints() {
    return Object.fromEntries(
      Object.entries(shortcuts).map(([action, key]) => [action, key ? keyLabel(key) : ""]),
    );
  }

  function triggerTaskAction(card, shortcutAction) {
    const id = card.dataset.id;
    const action = TASK_ACTION_BY_SHORTCUT[shortcutAction];
    if (!id || !action) return;
    onTaskAction?.({ action, id });
  }

  function updateHistoryMenu() {
    if (undoMenuButton) {
      undoMenuButton.disabled = !canUndo();
      undoMenuButton.textContent = canUndo() ? `Undo ${undoLabel()}` : "Undo";
    }
    if (redoMenuButton) {
      redoMenuButton.disabled = !canRedo();
      redoMenuButton.textContent = canRedo() ? `Redo ${redoLabel()}` : "Redo";
    }
  }

  async function runHistoryCommand(direction) {
    const label = direction === "undo" ? undoLabel() : redoLabel();
    const changed = direction === "undo" ? await undo() : await redo();
    if (!changed) return;
    updateHistoryMenu();
    await onHistoryApplied?.();
    showToast?.(`${direction === "undo" ? "Undo" : "Redo"}${label ? ` ${label}` : ""}`);
    requestAnimationFrame(restoreRememberedCard);
  }

  function handleGlobalKeydown(event) {
    if (document.querySelector("dialog[open]")) return;
    if (isEditableTarget(event.target)) return;

    const commandKey = event.ctrlKey || event.metaKey;
    if (commandKey && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === "z" || key === "y") {
        event.preventDefault();
        runHistoryCommand(key === "y" || event.shiftKey ? "redo" : "undo").catch(console.error);
        return;
      }
    }

    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const active = document.activeElement;
    const activeCard = active instanceof Element ? active.closest(".task-card") : null;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!activeCard && active !== document.body && active !== document.documentElement) return;
      event.preventDefault();
      moveTaskFocus(event.key === "ArrowDown" ? 1 : -1, activeCard);
      return;
    }

    if (!activeCard || active !== activeCard || event.repeat) return;
    const key = normalizeEventKey(event);
    const action = Object.keys(shortcuts).find((name) => shortcuts[name] && shortcuts[name] === key);
    if (!action) return;

    event.preventDefault();
    triggerTaskAction(activeCard, action);
  }

  function shortcutRow(name, label) {
    return `<label class="shortcut-row"><span>${label}</span><input class="shortcut-key-input" data-shortcut="${name}" readonly aria-label="${label} shortcut" /></label>`;
  }

  function fillShortcutInputs(dialog, values = shortcuts) {
    dialog.querySelectorAll("[data-shortcut]").forEach((input) => {
      const key = values[input.dataset.shortcut] ?? "";
      input.dataset.key = key;
      input.value = keyLabel(key);
    });
  }

  function captureShortcut(event) {
    if (event.key === "Tab" || event.key === "Escape") return;
    event.preventDefault();
    event.stopPropagation();

    const input = event.currentTarget;
    const error = document.querySelector("#shortcut-error");
    error.textContent = "";

    if (event.key === "Backspace" || event.key === "Delete") {
      input.dataset.key = "";
      input.value = keyLabel("");
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey || (event.key !== " " && event.key.length !== 1)) {
      error.textContent = "Use a single printable key or Space.";
      return;
    }

    const key = normalizeEventKey(event);
    input.dataset.key = key;
    input.value = keyLabel(key);
  }

  function saveShortcutSettings(event, dialog) {
    event.preventDefault();
    const next = {};
    const used = new Map();
    const error = dialog.querySelector("#shortcut-error");

    for (const input of dialog.querySelectorAll("[data-shortcut]")) {
      const action = input.dataset.shortcut;
      const key = input.dataset.key ?? "";
      if (key && used.has(key)) {
        error.textContent = `${keyLabel(key)} is assigned to more than one action.`;
        return;
      }
      if (key) used.set(key, action);
      next[action] = key;
    }

    shortcuts = next;
    localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(shortcuts));
    onShortcutsChanged?.(getShortcutHints());
    dialog.close();
  }

  function createShortcutDialog() {
    const dialog = document.createElement("dialog");
    dialog.id = "keyboard-shortcuts-dialog";
    dialog.className = "editor-dialog shortcut-dialog";
    dialog.innerHTML = `
      <form id="keyboard-shortcuts-form" method="dialog">
        <div class="dialog-header">
          <h2>Keyboard shortcuts</h2>
          <button type="button" class="icon-button" data-shortcut-close aria-label="Close">×</button>
        </div>
        <p class="shortcut-help">Task hotkeys apply when the task card itself is focused. ↑/↓ moves between visible tasks; Tab moves through the focused card's controls.</p>
        <div class="shortcut-grid">
          ${shortcutRow("complete", "Complete task")}
          ${shortcutRow("sleepTomorrow", "Sleep until tomorrow")}
          ${shortcutRow("sleepIndefinite", "Sleep indefinitely")}
          ${shortcutRow("customSleep", "Custom sleep")}
        </div>
        <p class="shortcut-help">Press a printable key or Space while a shortcut field is focused. Backspace or Delete clears it.</p>
        <p class="shortcut-error" id="shortcut-error" role="alert"></p>
        <div class="dialog-actions">
          <button type="button" class="secondary-button" data-shortcut-defaults>Restore defaults</button>
          <div class="spacer"></div>
          <button type="button" class="secondary-button" data-shortcut-close>Cancel</button>
          <button type="submit" class="primary-button">Save</button>
        </div>
      </form>`;
    document.body.append(dialog);

    dialog.querySelectorAll("[data-shortcut-close]").forEach((button) => {
      button.addEventListener("click", () => dialog.close());
    });
    dialog.querySelector("[data-shortcut-defaults]").addEventListener("click", () => fillShortcutInputs(dialog, DEFAULT_SHORTCUTS));
    dialog.querySelectorAll("[data-shortcut]").forEach((input) => input.addEventListener("keydown", captureShortcut));
    dialog.querySelector("form").addEventListener("submit", (event) => saveShortcutSettings(event, dialog));
    dialog.addEventListener("close", () => {
      dialog.querySelector("#shortcut-error").textContent = "";
      if (rememberedTaskId) requestAnimationFrame(restoreRememberedCard);
    });
    return dialog;
  }

  function positionDataMenu() {
    const menu = document.querySelector("#data-menu");
    const trigger = document.querySelector("#menu-button");
    if (!menu || !trigger || !menu.matches(":popover-open")) return;

    const rect = trigger.getBoundingClientRect();
    const gap = 6;
    const width = menu.offsetWidth;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    menu.style.left = `${left}px`;
    menu.style.top = `${rect.bottom + gap}px`;
  }

  function setupDataMenu() {
    const menu = document.querySelector("#data-menu");
    if (!menu) return;

    undoMenuButton = document.createElement("button");
    undoMenuButton.id = "undo-button";
    undoMenuButton.type = "button";
    undoMenuButton.addEventListener("click", () => {
      menu.hidePopover?.();
      runHistoryCommand("undo").catch(console.error);
    });

    redoMenuButton = document.createElement("button");
    redoMenuButton.id = "redo-button";
    redoMenuButton.type = "button";
    redoMenuButton.addEventListener("click", () => {
      menu.hidePopover?.();
      runHistoryCommand("redo").catch(console.error);
    });

    menu.prepend(redoMenuButton);
    menu.prepend(undoMenuButton);

    const dialog = createShortcutDialog();
    const button = document.createElement("button");
    button.id = "keyboard-shortcuts-button";
    button.type = "button";
    button.textContent = "Keyboard shortcuts…";
    button.addEventListener("click", () => {
      menu.hidePopover?.();
      fillShortcutInputs(dialog);
      dialog.showModal();
      requestAnimationFrame(() => dialog.querySelector("[data-shortcut]")?.focus());
    });
    menu.append(button);

    menu.addEventListener("toggle", (event) => {
      if (event.newState === "open") requestAnimationFrame(positionDataMenu);
    });
    window.addEventListener("resize", positionDataMenu);
    window.addEventListener("calendar:history-state", updateHistoryMenu);
    updateHistoryMenu();
  }

  taskSections.addEventListener("pointerdown", (event) => {
    const card = event.target instanceof Element ? event.target.closest(".task-card") : null;
    if (!card || isInteractiveTarget(event.target)) return;
    taskFocusActive = true;
    focusCard(card, { scroll: false });
  });

  document.addEventListener("focusin", (event) => {
    const card = event.target instanceof Element ? event.target.closest(".task-card") : null;
    taskFocusActive = !!card;
    if (card) rememberCard(card);
  });

  taskSections.addEventListener("toggle", scheduleTaskFocusSync, true);
  document.addEventListener("keydown", handleGlobalKeydown);
  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.addEventListener("close", () => {
      if (rememberedTaskId) requestAnimationFrame(restoreRememberedCard);
    });
  }

  setupDataMenu();

  return {
    getShortcutHints,
    syncTaskFocus: scheduleTaskFocusSync,
  };
}
