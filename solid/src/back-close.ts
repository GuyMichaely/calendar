import { createEffect, on, onCleanup, type Accessor } from "solid-js";

/*
 * Going back (a phone's back button or gesture, or the browser's) closes what's open over the
 * page, latest first, before it leaves anything. Each opening adds a history entry with the same
 * address, marked with its id; landing on an entry from before it closes it. Closed some other way
 * (×, Escape, saving), its entry is taken back off if it's still the current one. The Android app
 * asks `window.calendarBack()` first: true means going back closes something.
 */
type Open = { id: number; close: () => void; isOpen: Accessor<boolean> };
const stack: Open[] = [];
let nextId = 1;
// History moves this made itself (taking an entry back off), which aren't someone going back.
let ownMoves = 0;
const current = () => (history.state as { backClose?: number } | null)?.backClose;
const push = (entry: Open) => history.pushState({ ...(history.state ?? {}), backClose: entry.id }, "", location.href);

window.addEventListener("popstate", () => {
  if (ownMoves) { ownMoves--; return; }
  // Everything opened after the entry gone back to closes, latest first.
  const keep = stack.findIndex(entry => entry.id === current());
  const closing = stack.splice(keep + 1).reverse();
  for (const entry of closing) entry.close();
  // Something that didn't close (unsaved changes it can't keep, say) gets its entry back.
  setTimeout(() => { for (const entry of closing.reverse()) if (entry.isOpen() && !stack.includes(entry)) { stack.push(entry); push(entry); } });
});

(window as unknown as { calendarBack: () => boolean }).calendarBack = () => {
  if (!stack.length) return false;
  history.back();
  return true;
};

/** While `isOpen`, going back calls `close`. */
export function closeOnBack(isOpen: Accessor<boolean>, close: () => void) {
  const entry: Open = { id: nextId++, close, isOpen };
  const drop = () => {
    const index = stack.indexOf(entry);
    if (index < 0) return;
    stack.splice(index, 1);
    if (current() === entry.id) { ownMoves++; history.back(); }
  };
  createEffect(on(isOpen, (open, was) => {
    if (open && !was) { stack.push(entry); push(entry); }
    else if (!open && was) drop();
  }));
  onCleanup(drop);
}
