let rememberedTaskId: string | null = null;
let rememberedTaskIndex = 0;
let taskFocusActive = false;

export function visibleTaskCards() {
  return [...document.querySelectorAll<HTMLElement>('[data-task-card="true"]')].filter((card) => {
    if (card.closest("details:not([open])")) return false;
    return card.getClientRects().length > 0;
  });
}

export function rememberCard(card: HTMLElement) {
  const cards = visibleTaskCards();
  const index = cards.indexOf(card);
  if (index >= 0) rememberedTaskIndex = index;
  rememberedTaskId = card.dataset.id || rememberedTaskId;
  cards.forEach((candidate) => { candidate.tabIndex = candidate === card ? 0 : -1; });
}

export function focusCard(card: HTMLElement | undefined, { scroll = true } = {}) {
  if (!card) return;
  rememberCard(card);
  card.focus({ preventScroll: !scroll });
  if (scroll) card.scrollIntoView({ block: "nearest" });
}

export function moveTaskFocus(direction: number, activeCard?: HTMLElement) {
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

export function syncTaskFocus() {
  const cards = visibleTaskCards();
  if (!cards.length) return;
  const remembered = rememberedTaskId ? cards.find((card) => card.dataset.id === rememberedTaskId) : null;
  const roving = remembered || cards[Math.min(rememberedTaskIndex, cards.length - 1)] || cards[0];
  cards.forEach((card) => { card.tabIndex = card === roving ? 0 : -1; });
  if (taskFocusActive && document.activeElement === document.body) focusCard(roving, { scroll: false });
}

export function noteTaskFocus(target: EventTarget | null) {
  const card = target instanceof Element ? target.closest<HTMLElement>('[data-task-card="true"]') : null;
  taskFocusActive = !!card;
  if (card) rememberCard(card);
}

export function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && !!target.closest("button, a, input, textarea, select, label, [contenteditable='true']");
}

export function focusBoundaryTask(direction: 1 | -1) {
  const cards = visibleTaskCards();
  if (!cards.length) return false;
  focusCard(direction > 0 ? cards[0] : cards[cards.length - 1]);
  return true;
}

export function captureRovingTask() {
  return document.querySelector<HTMLElement>('[data-task-card="true"][tabindex="0"]');
}
