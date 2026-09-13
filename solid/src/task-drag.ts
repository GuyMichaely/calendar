import { createTaskDropGap } from "./task-drop-gap";

type Move = (id: string, target: string | null, placement: string) => Promise<void>;

// Card drags preserve ordinary clicks. Touch cards use a hold so swiping still
// scrolls; the dedicated handle remains an immediate touch-drag target.
export function startTaskDrag(event: PointerEvent, id: string, move: Move, descendants: string[] = []) {
  if (event.button !== 0) return;
  const handle = event.currentTarget as HTMLElement;
  const source = handle.closest<HTMLElement>("[data-task-card]");
  if (!source) return;
  const immediate = handle.matches(".task-drag-handle");
  if (immediate) { event.preventDefault(); event.stopPropagation(); }
  const holdToDrag = event.pointerType === "touch" && !immediate;
  const blocked = new Set([id, ...descendants]);
  let gap: ReturnType<typeof createTaskDropGap> | undefined;
  const controller = new AbortController();
  const options = { signal: controller.signal };
  let x = event.clientX, y = event.clientY, active = false, frame = 0;
  let target: HTMLElement | null = null;
  let placement = "";
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let preview: HTMLElement | null = null;
  let offsetX = 0, offsetY = 0;
  const positionPreview = () => {
    if (preview) preview.style.transform = `translate3d(${x - offsetX}px, ${y - offsetY}px, 0)`;
  };
  const activate = () => {
    active = true; handle.setPointerCapture(event.pointerId);
    const box = source.getBoundingClientRect();
    preview = document.createElement("div");
    preview.className = `task-drag-preview task-section tasks-panel${source.closest(".compact") ? " compact" : ""}`;
    preview.dataset.section = source.closest<HTMLElement>("[data-section]")?.dataset.section || "";
    preview.setAttribute("aria-hidden", "true");
    preview.inert = true;
    const width = Math.min(box.width, innerWidth - 24);
    const height = Math.min(box.height, innerHeight * .65);
    preview.style.width = `${width}px`;
    preview.style.maxHeight = `${height}px`;
    offsetX = Math.max(0, Math.min(event.clientX - box.left, width - 12));
    offsetY = Math.max(0, Math.min(event.clientY - box.top, height - 12));
    const copy = source.cloneNode(true) as HTMLElement;
    for (const element of [copy, ...copy.querySelectorAll<HTMLElement>("*")]) {
      for (const name of ["id", "data-id", "data-task-card", "data-drop", "tabindex"]) element.removeAttribute(name);
    }
    copy.style.marginInlineStart = "0";
    preview.append(copy);
    document.body.append(preview);
    source.classList.add("task-drag-source");
    positionPreview();
    document.body.classList.add("task-dragging");
    document.body.classList.toggle("task-dragging-child", !!source.dataset.parent);
    gap = createTaskDropGap(source);
  };
  const clearTarget = () => { if (target) delete target.dataset.drop; target = null; };
  const locate = () => {
    // Keep the destination while hovering its empty slot. Recomputing from
    // the displaced card would otherwise alternate between two positions.
    if (target?.isConnected && !target.closest('[inert]') && gap?.contains(x, y)) { positionPreview(); return; }
    clearTarget();
    const element = document.elementFromPoint(x, y);
    if (element?.closest('[data-drop-root]')) {
      target = element.closest<HTMLElement>('[data-drop-root]'); placement = 'root';
    } else {
      target = element?.closest<HTMLElement>('[data-task-card]') || null;
      if ((target?.dataset.id && blocked.has(target.dataset.id)) || target?.closest('[inert]')) target = null;
      if (target) { const box = target.getBoundingClientRect(); const fraction = (y - box.top) / box.height; placement = fraction < .25 ? 'before' : fraction > .75 ? 'after' : 'inside'; }
    }
    if (target) target.dataset.drop = placement;
    if (target && placement !== 'root') gap?.show(target, placement);
    else gap?.clear();
    positionPreview();
  };
  const tick = () => {
    if (active && !source.isConnected) { cleanup(); return; }
    if (active) {
      // Holding a card near the edge should not scroll before the finger moves.
      const moved = Math.hypot(x - event.clientX, y - event.clientY) > 6;
      const speed = moved ? y < 70 ? -12 : y > innerHeight - 70 ? 12 : 0 : 0;
      if (speed) window.scrollBy(0, speed);
      locate();
    }
    frame = requestAnimationFrame(tick);
  };
  const stopListening = () => {
    controller.abort(); clearTimeout(holdTimer); cancelAnimationFrame(frame);
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  };
  const clearVisuals = () => {
    clearTarget();
    preview?.remove(); preview = null; source.classList.remove('task-drag-source');
    document.body.classList.remove('task-dragging', 'task-dragging-child');
  };
  const cleanup = () => { stopListening(); clearVisuals(); gap?.remove(); };
  window.addEventListener('pointermove', next => {
    if (next.pointerId !== event.pointerId) return;
    x = next.clientX; y = next.clientY;
    if (!active && Math.hypot(x - event.clientX, y - event.clientY) > 6) {
      if (holdToDrag) { cleanup(); return; }
      activate();
    }
    if (active && next.cancelable) next.preventDefault();
    if (active) locate();
  }, options);
  window.addEventListener('pointerup', next => {
    if (next.pointerId !== event.pointerId) return;
    const targetId = target?.dataset.id || null, drop = placement, valid = active && !!target;
    if (active) {
      // A drag ending over a title must not also open its editor.
      const suppressClick = (click: MouseEvent) => { click.preventDefault(); click.stopImmediatePropagation(); };
      window.addEventListener('click', suppressClick, {capture: true, once: true});
      setTimeout(() => window.removeEventListener('click', suppressClick, true), 0);
    }
    if (!valid) { cleanup(); return; }
    stopListening();
    const before = gap?.measure();
    const row = source.closest<HTMLElement>('.task-collapse');
    if (before && row && preview) {
      const floating = preview.getBoundingClientRect(), cardBox = source.getBoundingClientRect(), rowBox = row.getBoundingClientRect();
      before.set(row, {
        left: floating.left + scrollX - (cardBox.left - rowBox.left),
        top: floating.top + scrollY - (cardBox.top - rowBox.top),
      });
    }
    void move(id, targetId, drop).finally(() => {
      clearVisuals();
      gap?.remove(before);
    });
  }, options);
  window.addEventListener('pointercancel', cleanup, options);
  window.addEventListener('blur', cleanup, options);
  window.addEventListener('keydown', key => { if (key.key === 'Escape') cleanup(); }, options);
  window.addEventListener('touchmove', touch => { if (active && touch.cancelable) touch.preventDefault(); }, {signal: controller.signal, passive: false});
  if (holdToDrag) holdTimer = setTimeout(() => { activate(); locate(); }, 350);
  frame = requestAnimationFrame(tick);
}
