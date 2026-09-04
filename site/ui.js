export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function localDateInput(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseTags(value) {
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function friendlyWhen(date, now = new Date()) {
  if (!date) return "";
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((target - today) / 86400000);
  if (days === 0) return `today · ${time}`;
  if (days === 1) return `tomorrow · ${time}`;
  if (days > 1 && days < 7) {
    return `${new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date)} · ${time}`;
  }
  return `${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date)} · ${time}`;
}

export function createToaster() {
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

  return function showToast(message, duration = 2600) {
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
  };
}
