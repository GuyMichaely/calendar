import { canRedo, canUndo, redo, redoLabel, undo, undoLabel } from "./storage.js";

const SHORTCUT_STORAGE_KEY = "calendar.keyboardShortcuts";
const DEFAULT_SHORTCUTS = {
  complete: " ",
  sleepTomorrow: "s",
  sleepIndefinite: "h",
  customSleep: "c",
};

const ICONS = {
  sleepTomorrow: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12.5" r="6.2" />
      <path d="M6.4 9.1h11.2" />
      <path d="M7.3 8.9c1.1-3.2 3.8-5.3 7.1-5.3 1.2 0 2.2.2 3.1.7l-2.2 4.6" />
      <circle cx="18.2" cy="4.4" r="1.25" />
      <path d="M8.4 12c.7.7 1.4.7 2.1 0M13.5 12c.7.7 1.4.7 2.1 0" />
      <path d="M9.3 15.1c1.8 1.1 3.6 1.1 5.4 0" />
    </svg>`,
  sleepIndefinite: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="7" cy="7" r="2.4" />
      <circle cx="17" cy="7" r="2.4" />
      <path d="M5.2 10.4C5.2 6.8 8.2 4.2 12 4.2s6.8 2.6 6.8 6.2v2.1c0 4-3 7.1-6.8 7.1s-6.8-3.1-6.8-7.1v-2.1Z" />
      <circle cx="9.2" cy="11.5" r=".7" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="11.5" r=".7" fill="currentColor" stroke="none" />
      <path d="M10.4 14.1c1.1.9 2.1.9 3.2 0" />
      <path d="M11 13.1h2" />
    </svg>`,
  customSleep: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M10.7 4.1a7.2 7.2 0 1 0 5.1 12.4A6.4 6.4 0 0 1 10.7 4.1Z" />
      <circle cx="16.8" cy="16.8" r="4.2" />
      <path d="M16.8 14.7v2.4l1.6 1" />
    </svg>`,
};

function ensureStyles() {
  if (document.querySelector('link[data-keyboard-styles="true"]')) return;
  const styleLink = document.createElement("link");
  styleLink.rel = "stylesheet";
  styleLink.href = new URL("./keyboard.css", import.meta.url).href;
  styleLink.dataset.keyboardStyles = "true";
  document.head.append(styleLink);
}

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

function formatLocalInput(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function tomorrowMidnight() {
  const result = new Date();
  result.setDate(result.getDate() + 1);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function createKeyboardController({ taskSections, showToast, onHistoryApplied }) {
  ensureStyles();

  let shortcuts = loadShortcuts();
  let rememberedTaskId = null;
  let rememberedTaskIndex = 0;
  let taskFocusActive = false;
  let enhanceScheduled = false;
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

  function openCustomSleep(card) {
    const button = card.querySelector('[data-action="sleep-custom"]');
    if (!button) return false;
    button.click();
    return true;
  }

  function triggerSleepTomorrow(card) {
    const directButton = card.querySelector('[data-action="sleep-tomorrow"]');
    if (directButton) {
      directButton.click();
      return;
    }
    if (!openCustomSleep(card)) return;
    requestAnimationFrame(() => {
      const input = document.querySelector("#quick-sleep-until");
      const form = document.querySelector("#sleep-form");
      if (!input || !form) return;
      input.value = formatLocalInput(tomorrowMidnight());
      form.requestSubmit();
    });
  }

  function triggerSleepIndefinitely(card) {
    if (!openCustomSleep(card)) return;
    requestAnimationFrame(() => document.querySelector("#sleep-indefinite")?.click());
  }

  function triggerTaskAction(card, action) {
    if (action === "complete") {
      card.querySelector('[data-action="complete"]')?.click();
      return;
    }
    if (action === "sleepTomorrow") {
      triggerSleepTomorrow(card);
      return;
    }
    if (action === "sleepIndefinite") {
      triggerSleepIndefinitely(card);
      return;
    }
    if (action === "customSleep") openCustomSleep(card);
  }

  function tooltip(action, label) {
    const key = shortcuts[action];
    return `${label}${key ? ` (${keyLabel(key)})` : ""}`;
  }

  function turnIntoIconButton(button, action, label, svg) {
    button.classList.remove("text-button");
    button.classList.add("task-action-icon");
    if (button.dataset.keyboardIcon !== action) {
      button.innerHTML = svg;
      button.dataset.keyboardIcon = action;
    }
    const text = tooltip(action, label);
    button.title = text;
    button.setAttribute("aria-label", text);
  }

  function enhanceCard(card) {
    if (!card.hasAttribute("tabindex")) card.tabIndex = -1;
    if (card.classList.contains("sleeping-task")) return;

    const tomorrow = card.querySelector('[data-action="sleep-tomorrow"]');
    const custom = card.querySelector('[data-action="sleep-custom"]');
    if (!tomorrow || !custom) return;

    turnIntoIconButton(tomorrow, "sleepTomorrow", "Sleep until tomorrow", ICONS.sleepTomorrow);
    turnIntoIconButton(custom, "customSleep", "Custom sleep", ICONS.customSleep);

    let indefinite = card.querySelector('[data-keyboard-action="sleep-indefinite"]');
    if (!indefinite) {
      indefinite = document.createElement("button");
      indefinite.type = "button";
      indefinite.className = "task-action-icon";
      indefinite.dataset.keyboardAction = "sleep-indefinite";
      indefinite.addEventListener("click", () => triggerSleepIndefinitely(card));
      tomorrow.after(indefinite);
    }
    if (indefinite.dataset.keyboardIcon !== "sleepIndefinite") {
      indefinite.innerHTML = ICONS.sleepIndefinite;
      indefinite.dataset.keyboardIcon = "sleepIndefinite";
    }
    const text = tooltip("sleepIndefinite", "Sleep indefinitely");
    indefinite.title = text;
    indefinite.setAttribute("aria-label", text);
  }

  function enhanceCards() {
    enhanceScheduled = false;
    const cards = visibleTaskCards();
    cards.forEach(enhanceCard);
    if (!cards.length) return;

    const current = rememberedTaskId ? cards.find((card) => card.dataset.id === rememberedTaskId) : null;
    const roving = current || cards[0];
    cards.forEach((card) => {
      card.tabIndex = card === roving ? 0 : -1;
    });

    if (taskFocusActive && document.activeElement === document.body) restoreRememberedCard();
  }

  function scheduleEnhance() {
    if (enhanceScheduled) return;
    enhanceScheduled = true;
    requestAnimationFrame(enhanceCards);
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
    dialog.close();
    scheduleEnhance();
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

  taskSections.addEventListener("toggle", scheduleEnhance, true);
  document.addEventListener("keydown", handleGlobalKeydown);
  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.addEventListener("close", () => {
      if (rememberedTaskId) requestAnimationFrame(restoreRememberedCard);
    });
  }

  setupDataMenu();

  return {
    enhance: scheduleEnhance,
  };
}
