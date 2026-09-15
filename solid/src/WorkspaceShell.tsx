import { Show, createSignal, type JSX } from "solid-js";
import { Icon } from "./Icon";
import type { View } from "./types";
export type TaskScope = "focus" | "all" | "completed";
export function WorkspaceShell(props: {
  view: View; scope: TaskScope; openCount: number; query: string;
  onQuery: (value: string) => void; onNavigate: (view: View, scope?: TaskScope) => void;
  onNew: () => void; onSettings: () => void; children: JSX.Element;
  syncLabel: string; syncDetail: string; syncState: "busy" | "error" | "synced" | "local";
  identity: string; canUndo: boolean; canRedo: boolean; undoLabel: string; redoLabel: string;
  onUndo: () => void; onRedo: () => void;
}) {
  const [searchOpen, setSearchOpen] = createSignal(false);
  let searchInput!: HTMLInputElement;
  const toggleSearch = () => { const open = !searchOpen(); setSearchOpen(open); if (!open) props.onQuery(""); else requestAnimationFrame(() => searchInput.focus()); };
  const selected = (scope: TaskScope) => props.view === "tasks" && props.scope === scope;
  const title = () => props.view === "calendar" ? "Calendar" : props.scope === "focus" ? "My day" : props.scope === "all" ? "All tasks" : "Completed";
  return <div class="workspace-layout">
    <a class="skip-link" href="#workspace-content" onClick={event => { event.preventDefault(); document.getElementById("workspace-content")?.focus(); }}>Skip to content</a>
    <aside class="workspace-rail">
      <button class="workspace-brand" onClick={() => props.onNavigate("tasks", "focus")} aria-label="Calendar home"><span class="brand-mark"><Icon name="calendar" size={23} /></span>Calendar<span class="brand-period">.</span></button>
      <span class="rail-caption">YOUR WORKSPACE</span>
      <nav class="rail-nav" aria-label="Workspace">
        <button classList={{active: selected("focus")}} aria-current={selected("focus") ? "page" : undefined} onClick={() => props.onNavigate("tasks", "focus")}><Icon name="sun" /><span>My day</span></button>
        <button classList={{active: selected("all")}} aria-current={selected("all") ? "page" : undefined} onClick={() => props.onNavigate("tasks", "all")}><Icon name="list" /><span>All tasks</span><span class="nav-count">{props.openCount}</span></button>
        <button classList={{active: props.view === "calendar"}} aria-current={props.view === "calendar" ? "page" : undefined} onClick={() => props.onNavigate("calendar")}><Icon name="calendar" /><span>Calendar</span></button>
        <button classList={{active: selected("completed")}} aria-current={selected("completed") ? "page" : undefined} onClick={() => props.onNavigate("tasks", "completed")}><Icon name="done" /><span>Completed</span></button>
      </nav>
      <div class="rail-bottom">
        <button class="rail-settings" onClick={props.onSettings}><Icon name="settings" /><span>Settings</span></button>
        <div class="workspace-identity"><span class="identity-icon"><Icon name="user" size={17} /></span><span><strong>{props.identity || "Personal workspace"}</strong><small>Your plans, at your pace</small></span></div>
      </div>
    </aside>
    <div class="workspace-body">
      <header class="workspace-topbar">
        <div class="workspace-breadcrumb"><span class="desktop-word">Workspace</span><span class="desktop-word separator">/</span><strong class="desktop-word">{title()}</strong><strong class="mobile-word">Calendar<span class="mobile-brand-period">.</span></strong></div>
        <label class="workspace-search" data-open={searchOpen() || !!props.query}><Icon name="search" size={17} /><span class="visually-hidden">{props.view === "calendar" ? "Search calendar" : "Search tasks"}</span><input ref={searchInput} type="search" placeholder={props.view === "calendar" ? "Search calendar" : "Search tasks"} value={props.query} onInput={event => props.onQuery(event.currentTarget.value)} autocomplete="off" /><Show when={props.query}><button type="button" aria-label="Clear search" onClick={() => props.onQuery("")}>×</button></Show></label>
        <div class="workspace-utilities"><button class="icon-button mobile-search-toggle" aria-label={searchOpen() ? "Close search" : "Search"} aria-expanded={searchOpen() || !!props.query} onClick={toggleSearch}><Icon name="search" size={17} /></button>
          <button class="sync-indicator" data-state={props.syncState} title={props.syncDetail} aria-label={`${props.syncLabel}. Open sync settings`} onClick={props.onSettings}><Icon name={props.syncState === "error" ? "alert" : props.syncState === "local" ? "device" : "cloud"} size={17} /><span role="status">{props.syncLabel}</span></button>
          <div class="mobile-history" aria-label="History"><button class="icon-button" aria-label="Undo" title={props.undoLabel || "Undo"} disabled={!props.canUndo} onClick={props.onUndo}>↶</button><button class="icon-button" aria-label="Redo" title={props.redoLabel || "Redo"} disabled={!props.canRedo} onClick={props.onRedo}>↷</button></div>
          <button class="primary-button workspace-new" onClick={props.onNew}><Icon name="plus" size={17} />{props.view === "calendar" ? "New event" : "New task"}</button>
        </div>
      </header>
      <main id="workspace-content" tabIndex={-1}>{props.children}</main>
    </div>
    <nav class="mobile-nav" aria-label="Primary">
      <button classList={{active: props.view === "tasks"}} aria-current={props.view === "tasks" ? "page" : undefined} onClick={() => props.onNavigate("tasks")}><Icon name="list" /><span>Tasks</span></button>
      <button classList={{active: props.view === "calendar"}} aria-current={props.view === "calendar" ? "page" : undefined} onClick={() => props.onNavigate("calendar")}><Icon name="calendar" /><span>Calendar</span></button>
      <button class="mobile-create" aria-label={props.view === "calendar" ? "New event" : "New task"} onClick={props.onNew}><span><Icon name="plus" /></span></button>
      <button onClick={props.onSettings}><Icon name="settings" /><span>Settings</span></button>
    </nav>
  </div>;
}
