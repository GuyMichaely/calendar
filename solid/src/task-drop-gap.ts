type Position = { left: number; top: number };

// The gap is temporary presentation only. Keep Solid's keyed task rows in
// place, and use their actual layout to make hit testing match the preview.
export function createTaskDropGap(source: HTMLElement) {
  const panel = source.closest<HTMLElement>(".tasks-panel")!;
  const gap = document.createElement("div");
  gap.className = "task-drop-gap";
  gap.setAttribute("aria-hidden", "true");
  const space = document.createElement("div");
  space.className = "task-drop-space";
  gap.append(space);
  gap.style.height = `${source.closest(".task-collapse")!.getBoundingClientRect().height}px`;
  const animations = new Map<HTMLElement, Animation>();
  const measure = () => new Map([...panel.querySelectorAll<HTMLElement>(
    ".section-task-list > .task-collapse, .task-section-toggle, .sleeping-heading, .horizon-row",
  )].filter(element => !element.closest("[inert]")).map(element => {
    const box = element.getBoundingClientRect();
    return [element, {left: box.left + scrollX, top: box.top + scrollY}] as const;
  }));
  const cancelAnimations = () => {
    for (const animation of animations.values()) animation.cancel();
    animations.clear();
  };
  const animateFrom = (before: Map<HTMLElement, Position>) => {
    if (!panel.classList.contains("motion-enabled")) return;
    for (const [element, after] of measure()) {
      const previous = before.get(element);
      if (!previous) continue;
      const x = previous.left - after.left, y = previous.top - after.top;
      if (Math.abs(x) < .5 && Math.abs(y) < .5) continue;
      const animation = element.animate([
        {transform: `translate(${x}px, ${y}px)`}, {transform: "translate(0, 0)"},
      ], {duration: 180, easing: "ease-out"});
      animations.set(element, animation);
      animation.onfinish = () => { if (animations.get(element) === animation) animations.delete(element); };
    }
  };
  const change = (update: () => void) => {
    const before = measure();
    cancelAnimations(); update(); animateFrom(before);
  };
  return {
    contains(x: number, y: number) {
      if (!gap.isConnected) return false;
      const box = gap.getBoundingClientRect();
      return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
    },
    show(target: HTMLElement, placement: string) {
      const row = target.closest<HTMLElement>(".task-collapse");
      const list = row?.parentElement;
      if (!row || !list?.classList.contains("section-task-list")) return;
      const depth = Number(target.dataset.depth || 0);
      let after = row;
      // In the flattened tree, a sibling goes after the whole subtree; a new
      // child is appended there too, but indented one level further.
      if (placement !== "before") {
        for (let next = after.nextElementSibling; next; next = next.nextElementSibling) {
          if (next === gap) continue;
          const card = next.querySelector<HTMLElement>("[data-task-card]");
          if (!card || Number(card.dataset.depth || 0) <= depth) break;
          after = next as HTMLElement;
        }
      }
      const anchor = placement === "before" ? row : after.nextElementSibling === gap ? gap.nextElementSibling : after.nextElementSibling;
      space.style.marginInlineStart = `${Math.min(depth + (placement === "inside" ? 1 : 0), 5) * 12}px`;
      space.textContent = placement === "inside" ? "Add as subtask" : "Move here";
      if (gap.parentElement === list && gap.nextElementSibling === anchor) return;
      change(() => list.insertBefore(gap, anchor));
    },
    clear() { if (gap.isConnected) change(() => gap.remove()); },
    // Snapshot before saving so the final layout continues smoothly from the
    // open gap. No temporary ordering is ever written to the document.
    measure,
    remove(before?: Map<HTMLElement, Position>) {
      cancelAnimations(); gap.remove();
      if (before) animateFrom(before);
    },
  };
}
