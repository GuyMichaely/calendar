# Subtasks

Tasks can have an optional `parentId` referencing another task. There is no nesting-depth limit. Existing tasks without a parent remain top-level tasks; backups and Automerge sync preserve these links.

Use the + button beside a task or Add subtask in its editor to create a child. Drag the card body or title to move an existing task. On touch screens, hold briefly before dragging; ordinary swipes still scroll. The two-line grip also supports immediate dragging. Drop near the top/bottom of a card to reorder siblings, in its center to make it a child, or in the top-level drop area to make it independent. On a focused handle, Up/Down reorders and Left makes the task top-level. Name a new task before adding its children.

Task sections retain their existing availability filters. Within each section, children appear below their nearest visible ancestor; a parent outside the filter does not hide its children. Parent links open the parent editor. Disclosure arrows collapse visible descendants, while searching ignores collapsed state. Indentation is capped to keep deep trees usable on narrow screens, without limiting the stored hierarchy.

Completing a parent completes all descendants currently known to that device in the same local document write. One undo restores the group's prior states. Reopening a child, or adding/moving an open child under a completed parent, reopens completed ancestors. Deleting a parent deletes all its descendants in the same local write; one undo restores the entire group and its parent links.

Completion does not claim to include changes that another offline device has not yet shared. Those changes merge normally. Local moves and imports reject cycles; if concurrent moves form a cycle, the view still displays those tasks so a user can drag one to the top-level drop area.

Saved locally means the browser has persisted the edit. It does not confirm remote delivery; the app's Syncing / Synced at / sync error status reports that separately.

Manual sibling order is stored in `sortOrder` and travels with backups and sync. A move writes the parent link and affected sibling positions together; undo restores the move as a group. Concurrent positions use Automerge merge semantics.

Settings has an Animations tab with a switch for category/subtask expansion, completion/undo transitions, and the shared rotating chevron. By default, transitions follow the device’s reduced-motion preference. Explicitly switching animations on or off overrides that preference for this browser; Use device preference restores the default. Cards are keyed by task ID so refresh and collapse changes preserve their DOM identity; refresh never restores focus to an unfocused task.

Closing an editor opened from a parent's Add subtask control returns to that parent's editor, loading its latest saved data. This works at any depth. Unsaved tasks cannot be parents. Up/Down task navigation wraps from the first task to the last and vice versa.
