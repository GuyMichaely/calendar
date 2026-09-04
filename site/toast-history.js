import { redo, redoLabel, undo, undoLabel } from "./storage.js";

const legacyToast = document.querySelector("#toast");
let stack = null;

function ensureStack() {
  if (stack) return stack;
  stack = document.createElement("div");
  stack.className = "toast-stack";
  stack.setAttribute("aria-live", "polite");
  stack.setAttribute("aria-relevant", "additions");
  document.body.append(stack);
  return stack;
}

function dismiss(toast) {
  if (!toast?.isConnected) return;
  toast.classList.add("leaving");
  setTimeout(() => toast.remove(), 140);
}

function showToast(message, duration = 2600) {
  if (!message) return;
  const toast = document.createElement("button");
  toast.type = "button";
  toast.className = "queued-toast";
  toast.textContent = message;
  toast.title = "Dismiss";
  toast.addEventListener("click", () => dismiss(toast));
  ensureStack().append(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  const timer = setTimeout(() => dismiss(toast), duration);
  toast.addEventListener("click", () => clearTimeout(timer), { once: true });
}

window.addEventListener("calendar:toast", (event) => showToast(event.detail?.message));

if (legacyToast) {
  new MutationObserver((records) => {
    if (!records.some((record) => record.type === "childList" || record.type === "characterData")) return;
    const message = legacyToast.textContent?.trim();
    if (message) showToast(message);
  }).observe(legacyToast, { childList: true, characterData: true, subtree: true });
}

function editable(target) {
  return target instanceof Element && !!target.closest("input, textarea, select, [contenteditable='true']");
}

async function runHistory(direction) {
  const label = direction === "undo" ? undoLabel() : redoLabel();
  const changed = direction === "undo" ? await undo() : await redo();
  if (!changed) return;
  showToast(`${direction === "undo" ? "Undid" : "Redid"}${label ? ` ${label}` : ""}`);
  document.querySelector(".primary-nav .nav-button.active")?.click();
}

document.addEventListener(
  "keydown",
  (event) => {
    if (document.querySelector("dialog[open]") || editable(event.target)) return;
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key !== "z" && key !== "y") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    runHistory(key === "y" || event.shiftKey ? "redo" : "undo").catch(console.error);
  },
  true,
);

document.addEventListener(
  "click",
  (event) => {
    const button = event.target instanceof Element ? event.target.closest("#undo-button, #redo-button") : null;
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    document.querySelector("#data-menu")?.hidePopover?.();
    runHistory(button.id === "undo-button" ? "undo" : "redo").catch(console.error);
  },
  true,
);
