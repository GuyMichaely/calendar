# Google Drive attachments: proposed first release

Status: design only. No Drive permissions, keys, or account settings have been changed.

## Start with an explicit copy

Add **From Google Drive…** beside the existing file chooser in the Attachments section. Open Google's own Picker, then show the selected filename and **Attach a copy**. The selected file is downloaded once and uploaded through the existing private attachment endpoint. Notes use the same `attachment:<id>` link, so downloads work on every synced device without another Drive sign-in.

Explain before importing: “This saves a copy in Calendar. Later changes in Drive won't update this attachment.” For Google Docs, Sheets, and Slides, offer a supported export format (PDF by default where available) and show the resulting filename. Honor download/export restrictions and the backend's attachment-size limit; report unsupported files before creating an attachment reference. Do not alter or delete the source file.

This approach fits the existing immutable attachments and Automerge metadata without introducing external sharing rules into ordinary downloads. Other providers can return a `File` through the same chooser interface later.

## Google integration

Use Google Picker rather than building a Drive browser. Picker returns selected-file metadata. Request `drive.file` only when the user chooses Drive; this is Google's recommended per-file scope, though it grants more than read access to selected files. The implementation will only read/export them. Keep the existing Calendar sign-in separate; signing in must not automatically request Drive access. See [Picker overview](https://developers.google.com/workspace/drive/picker/guides/overview) and [Drive scope guidance](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

Configure Drive API and Picker API in the Google project, a browser-restricted Picker API key, and the frontend JavaScript origin `https://guymichaely.com`. Confirm the OAuth consent configuration and test users. Use Google Identity Services for a short-lived browser access token, held only in memory. Do not put it in backups, Automerge, localStorage, or logs. This prototype needs no persistent Drive refresh token on the sync server.

Download ordinary files using the Drive download API; export native Workspace documents using supported export formats. Recheck file capability and size before transfer, handle expired tokens with an explicit reconnect action, and leave the editor's unsaved file visible for retry if the Calendar upload fails. See [Google download/export guidance](https://developers.google.com/workspace/drive/api/guides/manage-downloads).

## Later: attach a live link

Offer **Link to original** as a distinct choice. Store provider, file ID, display name, and a validated HTTPS viewing URL. Label it “Open in Google Drive,” since it opens the original rather than initiating a Calendar download. Each device/user needs access in Drive; Calendar must not silently modify sharing. Do not turn these URLs into arbitrary backend fetch targets.

A live link should be a distinct attachment type before shipping: current attachment IDs imply an immutable file exists on the Calendar server. Mixing links into that type would make offline behavior and backup expectations misleading.

## Verification before enabling

Exercise Picker cancel/permission denial; ordinary files and native-document exports; restricted/oversized files; token expiry; upload retry; cross-device download; and detaching/undoing an attachment. Confirm no tokens enter the CRDT or exported JSON. The UI should also distinguish copy vs original for users who have both attached.
