import { Show, createSignal, onCleanup, type JSX } from "solid-js";
import { Icon, type IconName } from "./Icon";
import type { View } from "./types";

export type SyncState = "local" | "busy" | "synced" | "pending" | "offline" | "signed-out" | "error";
const syncIcons: Record<SyncState, IconName> = { local: "cloud-off", busy: "refresh", synced: "cloud-check", pending: "cloud-up", offline: "wifi-off", "signed-out": "cloud-lock", error: "cloud-x" };
export function WorkspaceShell(props: {
  view: View; openCount: number; query: string;
  onQuery: (value: string) => void; onNavigate: (view: View) => void;
  onNew: () => void; onSettings: () => void; onSyncNow: () => void; children: JSX.Element;
  syncLabel: string; syncDetail: string; syncState: SyncState;
  canUndo: boolean; canRedo: boolean; undoLabel: string; redoLabel: string;
  onUndo: () => void; onRedo: () => void;
  // The clock that shows (and pretends) what the app treats as now.
  notice?: JSX.Element;
  // Search that finds (Settings → Display): its results under the field, and the field's keys and focus.
  searchResults?: JSX.Element; onSearchKeyDown?: (event: KeyboardEvent) => void; onSearchFocus?: () => void; searchExpanded?: boolean;
}) {
  const [searchOpen, setSearchOpen] = createSignal(false);
  // The top bar's height, for what sticks below it (--topbar-height).
  const watchTopbar = (header: HTMLElement) => {
    const observer = new ResizeObserver(() => document.documentElement.style.setProperty("--topbar-height", `${header.offsetHeight}px`));
    observer.observe(header);
    onCleanup(() => observer.disconnect());
  };
  const searchLabel = () => props.searchResults ? "Search everything" : props.view === "calendar" ? "Search calendar" : props.view === "agenda" ? "Search agenda" : "Search tasks";
  let searchInput!: HTMLInputElement;
  const toggleSearch = () => { const open = !searchOpen(); setSearchOpen(open); if (!open) props.onQuery(""); else requestAnimationFrame(() => searchInput.focus()); };
  return <div class="workspace-layout">
    <a class="skip-link" href="#workspace-content" onClick={event => { event.preventDefault(); document.getElementById("workspace-content")?.focus(); }}>Skip to content</a>
    <aside class="workspace-rail">
      <button class="workspace-brand" onClick={() => props.onNavigate("agenda")} aria-label="Calendar home"><span class="brand-mark"><Icon name="calendar" size={23} /></span>Calendar<span class="brand-period">.</span></button>
      <nav class="rail-nav" aria-label="Workspace">
        <button classList={{active: props.view === "agenda"}} aria-current={props.view === "agenda" ? "page" : undefined} onClick={() => props.onNavigate("agenda")}><Icon name="sun" /><span>Agenda</span></button>
        <button classList={{active: props.view === "list"}} aria-current={props.view === "list" ? "page" : undefined} onClick={() => props.onNavigate("list")}><Icon name="list" /><span>List</span><span class="nav-count">{props.openCount}</span></button>
        <button classList={{active: props.view === "boards"}} aria-current={props.view === "boards" ? "page" : undefined} onClick={() => props.onNavigate("boards")}><Icon name="compact" /><span>Boards</span></button>
        <button classList={{active: props.view === "calendar"}} aria-current={props.view === "calendar" ? "page" : undefined} onClick={() => props.onNavigate("calendar")}><Icon name="calendar" /><span>Calendar</span></button>
      </nav>
      <div class="rail-bottom">
        <button class="rail-settings" onClick={props.onSettings}><Icon name="settings" /><span>Settings</span></button>
      </div>
    </aside>
    <div class="workspace-body">
      <header class="workspace-topbar" ref={watchTopbar}>
        <strong class="mobile-word">Calendar<span class="mobile-brand-period">.</span></strong>
        <Show when={props.notice}>{props.notice}</Show>
        <label class="workspace-search" data-open={searchOpen() || !!props.query}><Icon name="search" size={17} /><input ref={searchInput} type="search" aria-label={searchLabel()} placeholder={searchLabel()} value={props.query} onInput={event => props.onQuery(event.currentTarget.value)} onKeyDown={event => props.onSearchKeyDown?.(event)} onFocus={() => props.onSearchFocus?.()} aria-expanded={props.searchResults ? !!props.searchExpanded : undefined} aria-controls={props.searchResults ? "search-results" : undefined} autocomplete="off" /><Show when={props.query}><button type="button" aria-label="Clear search" onClick={() => props.onQuery("")}>×</button></Show>{props.searchResults}</label>
        <div class="workspace-utilities"><button class="icon-button mobile-search-toggle" aria-label={searchOpen() ? "Close search" : "Search"} aria-expanded={searchOpen() || !!props.query} onClick={toggleSearch}><Icon name="search" size={17} /></button>
          <button class="sync-indicator" data-state={props.syncState} title={props.syncDetail} aria-label={props.syncState === "pending" ? `${props.syncLabel}. Sync now` : `${props.syncLabel}. Open sync settings`} onClick={() => props.syncState === "pending" ? props.onSyncNow() : props.onSettings()}><Icon name={syncIcons[props.syncState]} size={17} /><span role="status">{props.syncLabel}</span></button>
          <button class="icon-button mobile-settings" aria-label="Settings" onClick={props.onSettings}><Icon name="settings" size={17} /></button>
          <div class="mobile-history" aria-label="History"><button class="icon-button" aria-label="Undo" title={props.undoLabel || "Undo"} disabled={!props.canUndo} onClick={props.onUndo}>↶</button><button class="icon-button" aria-label="Redo" title={props.redoLabel || "Redo"} disabled={!props.canRedo} onClick={props.onRedo}>↷</button></div>
          <button class="primary-button workspace-new" onClick={props.onNew}><Icon name="plus" size={17} />{props.view === "calendar" ? "New event" : "New task"}</button>
        </div>
      </header>
      <main id="workspace-content" tabIndex={-1}>{props.children}</main>
    </div>
    <nav class="mobile-nav" aria-label="Primary">
      <button classList={{active: props.view === "agenda"}} aria-current={props.view === "agenda" ? "page" : undefined} onClick={() => props.onNavigate("agenda")}><Icon name="sun" /><span>Agenda</span></button>
      <button classList={{active: props.view === "list"}} aria-current={props.view === "list" ? "page" : undefined} onClick={() => props.onNavigate("list")}><Icon name="list" /><span>List</span></button>
      <button class="mobile-create" aria-label={props.view === "calendar" ? "New event" : "New task"} onClick={props.onNew}><span><Icon name="plus" /></span></button>
      <button classList={{active: props.view === "boards"}} aria-current={props.view === "boards" ? "page" : undefined} onClick={() => props.onNavigate("boards")}><Icon name="compact" /><span>Boards</span></button>
      <button classList={{active: props.view === "calendar"}} aria-current={props.view === "calendar" ? "page" : undefined} onClick={() => props.onNavigate("calendar")}><Icon name="calendar" /><span>Calendar</span></button>
    </nav>
  </div>;
}
