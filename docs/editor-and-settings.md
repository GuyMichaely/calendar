# Editor and settings

Settings (the gear button) contains Data and desktop Keyboard shortcuts. Data includes import/export, server setup, sign-in, Sync now, and a per-device remote polling interval: 5, 15, 30, 60, or 300 seconds, or no periodic checks. Local edits still sync after saving; reconnect/resume also checks the server. Only a visible online app polls. The default remains 15 seconds.

Mobile has dimmable ↶ / ↷ undo/redo buttons. Desktop uses Ctrl/Cmd+Z and redo through Ctrl/Cmd+Shift+Z or Ctrl+Y. Focused-task editing defaults to Enter and can be reassigned or cleared alongside the other task shortcuts.

The item title is editable in the dialog header. Valid changes autosave after a short pause; Close flushes remaining changes. There is no separate item Save button. Complete task and Reopen task replace the state dropdown. Old canceled records retain their stored state until reopened; new canceled states cannot be created through the editor.

Notes support Markdown with Write/Preview. Markdown stays in the existing Automerge text field. HTML is escaped and remote image embedding is disabled. In Attachments, click a filename to download, Link in notes to insert its download link at the notes cursor, or Remove to detach it. Removal preserves server bytes for undo, historical versions, and other devices; it is not permanent blob erasure. A removed file's old notes link reports that the attachment is no longer present.

One-time Can start markers appear only while that opportunity is in the future. Once the task becomes workable it remains in Can do now/the calendar's workable-task representation, rather than leaving a marker on a past start date. Future sleep-delayed opportunities and due/latest-start dates retain their behavior.

The Google Drive picker proposal is in [drive-attachments-plan.md](drive-attachments-plan.md).

Validation includes Markdown injection/link tests, elapsed-start calendar projection, configurable shortcut dispatch, and a stale-editor attachment-removal test that preserves a concurrent attachment addition and restores both references on undo. Browser checks use synthetic local items and an isolated attachment fixture; the fixture is removed before publishing.

JSON backups have a single top-level `items` field. Task activity `history` is preserved; browser undo/redo history and Automerge change history are not. Attachment metadata is included, but file bytes are not. Older backups with `version` or `exportedAt` remain importable.
