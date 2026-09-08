# Subtasks

Tasks can have an optional `parentId` referencing another task. There is no nesting-depth limit. Existing tasks without a parent remain top-level tasks; backups and Automerge sync preserve these links.

Use the + button beside a task or Add subtask in its editor to create a child. The editor's Parent task selector moves an existing task, and No parent makes it independent. Name a new task before adding its children.

Task sections retain their existing availability filters. Within each section, children appear below their nearest visible ancestor; a parent outside the filter does not hide its children. Parent links open the parent editor. Disclosure arrows collapse visible descendants, while searching ignores collapsed state. Indentation is capped to keep deep trees usable on narrow screens, without limiting the stored hierarchy.

Completing a parent completes all descendants currently known to that device in the same local document write. One undo restores the group's prior states. Reopening a child, or adding/moving an open child under a completed parent, reopens completed ancestors. Deleting a parent keeps its children, which appear independently when their parent no longer exists.

Completion does not claim to include changes that another offline device has not yet shared. Those changes merge normally. Local moves and imports reject cycles; if concurrent moves form a cycle, the view still displays those tasks so a user can move one to No parent.

Saved locally means the browser has persisted the edit. It does not confirm remote delivery; the app's Syncing / Synced at / sync error status reports that separately.
