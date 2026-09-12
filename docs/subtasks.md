# Subtasks

Tasks can have an optional `parentId` referencing another task. There is no nesting-depth limit. Existing tasks without a parent remain top-level tasks; backups and Automerge sync preserve these links.

Use the + button beside a task or Add subtask in its editor to create a child. Drag the two-line grip to move an existing task. Drop near the top/bottom of a card to reorder siblings, in its center to make it a child, or in the top-level drop area to make it independent. On a focused handle, Up/Down reorders and Left makes the task top-level. Name a new task before adding its children.

Task sections retain their existing availability filters. Within each section, children appear below their nearest visible ancestor; a parent outside the filter does not hide its children. Parent links open the parent editor. Disclosure arrows collapse visible descendants, while searching ignores collapsed state. Indentation is capped to keep deep trees usable on narrow screens, without limiting the stored hierarchy.

Completing a parent completes all descendants currently known to that device in the same local document write. One undo restores the group's prior states. Reopening a child, or adding/moving an open child under a completed parent, reopens completed ancestors. Deleting a parent deletes all its descendants in the same local write; one undo restores the entire group and its parent links.

Completion does not claim to include changes that another offline device has not yet shared. Those changes merge normally. Local moves and imports reject cycles; if concurrent moves form a cycle, the view still displays those tasks so a user can drag one to the top-level drop area.

Saved locally means the browser has persisted the edit. It does not confirm remote delivery; the app's Syncing / Synced at / sync error status reports that separately.

Manual sibling order is stored in `sortOrder` and travels with backups and sync. A move writes the parent link and affected sibling positions together; undo restores the move as a group. Concurrent positions use Automerge merge semantics.

The top of Settings includes an Animations switch for category/subtask expansion and the shared rotating chevron. Reduced-motion system preferences also disable these transitions. Cards are keyed by task ID so refresh and collapse changes preserve their DOM identity; refresh never restores focus to an unfocused task.
