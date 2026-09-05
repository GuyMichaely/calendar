import { putLocalAttachmentBlob } from "../../site/attachment-storage.js";
import { syncCalendarStorage } from "../../sync/client.js";

export type RemoteIdentity = {
  issuer: string;
  subject: string;
  email?: string | null;
  emailVerified?: boolean | null;
  name?: string | null;
  picture?: string | null;
};

export type RemoteSession = {
  authenticated: boolean;
  identity: RemoteIdentity | null;
};

type RemoteAttachment = {
  id: string;
  name?: string;
  type?: string;
  size?: number;
  blob?: Blob;
};

type RemoteItem = {
  attachments?: RemoteAttachment[];
};

type RemoteStorage = {
  readSnapshot: () => Promise<Uint8Array>;
  mergeSnapshot: (bytes: Uint8Array) => Promise<unknown>;
  putAttachmentBlob?: (id: string, blob: Blob) => Promise<void>;
};

type RemoteClientOptions = {
  backendUrl: string;
  storage: RemoteStorage;
  fetch?: typeof fetch;
};

type RemoteSyncQueueOptions = {
  sync: () => Promise<unknown>;
  onBusyChange?: (busy: boolean) => void;
  onSynced?: () => void | Promise<void>;
  onError?: (error: unknown) => void;
};

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const url = new URL(trimmed);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  url.search = "";
  url.hash = "";
  return url.href;
}

function requestError(message: string, status: number) {
  return Object.assign(new Error(`${message} (${status}).`), { status });
}

function uniqueAttachments(items: RemoteItem[]) {
  const attachments = new Map<string, RemoteAttachment>();
  for (const item of items) {
    for (const attachment of item.attachments || []) {
      if (!attachment?.id) continue;
      const existing = attachments.get(attachment.id);
      if (!existing || (!existing.blob && attachment.blob)) attachments.set(attachment.id, attachment);
    }
  }
  return [...attachments.values()];
}

export function configuredBackendUrl(value = import.meta.env?.VITE_CALENDAR_BACKEND_URL || "") {
  return normalizeBaseUrl(value);
}

export function createRemoteCalendarClient({ backendUrl, storage, fetch: fetchImpl = globalThis.fetch }: RemoteClientOptions) {
  const baseUrl = normalizeBaseUrl(backendUrl);
  if (!baseUrl) throw new Error("Remote calendar client requires a backend URL.");
  if (typeof fetchImpl !== "function") throw new Error("Remote calendar client requires Fetch API support.");

  const endpoint = (path: string) => new URL(path.replace(/^\//u, ""), baseUrl).href;
  const putAttachmentBlob = storage.putAttachmentBlob || putLocalAttachmentBlob;

  const syncAttachments = async (items: RemoteItem[], signal?: AbortSignal) => {
    for (const attachment of uniqueAttachments(items)) {
      const url = endpoint(`attachments/${encodeURIComponent(attachment.id)}`);
      if (attachment.blob instanceof Blob) {
        const existing = await fetchImpl(url, { method: "HEAD", credentials: "include", signal });
        if (existing.ok) continue;
        if (existing.status !== 404) throw requestError("Could not check remote attachment", existing.status);
        const upload = await fetchImpl(url, {
          method: "PUT",
          credentials: "include",
          signal,
          headers: { "content-type": attachment.blob.type || attachment.type || "application/octet-stream" },
          body: attachment.blob,
        });
        if (!upload.ok) throw requestError("Could not upload attachment", upload.status);
        continue;
      }

      const download = await fetchImpl(url, { credentials: "include", signal });
      if (download.status === 404) continue;
      if (!download.ok) throw requestError("Could not download attachment", download.status);
      const contentType = download.headers.get("content-type") || attachment.type || "application/octet-stream";
      const blob = new Blob([await download.arrayBuffer()], { type: contentType });
      await putAttachmentBlob(attachment.id, blob);
    }
  };

  return {
    loginUrl(provider = "google") {
      return endpoint(`auth/login/${encodeURIComponent(provider)}`);
    },

    async session(): Promise<RemoteSession> {
      const response = await fetchImpl(endpoint("auth/me"), { credentials: "include" });
      if (response.status === 401) return { authenticated: false, identity: null };
      if (!response.ok) throw requestError("Could not check calendar login", response.status);
      const body = await response.json() as { authenticated?: boolean; identity?: RemoteIdentity };
      if (!body.authenticated || !body.identity?.issuer || !body.identity?.subject) {
        throw new Error("Calendar backend returned an invalid authenticated session.");
      }
      return { authenticated: true, identity: body.identity };
    },

    async logout() {
      const response = await fetchImpl(endpoint("auth/logout"), {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw requestError("Could not sign out", response.status);
    },

    async sync(signal?: AbortSignal) {
      const result = await syncCalendarStorage(storage, {
        endpoint: endpoint("sync"),
        fetch: fetchImpl,
        credentials: "include",
        signal,
      });
      if (Array.isArray(result)) await syncAttachments(result as RemoteItem[], signal);
      return result;
    },
  };
}

export function createRemoteSyncQueue({ sync, onBusyChange, onSynced, onError }: RemoteSyncQueueOptions) {
  let pending = false;
  let current: Promise<void> | null = null;

  const drain = async () => {
    onBusyChange?.(true);
    try {
      while (pending) {
        pending = false;
        await sync();
        await onSynced?.();
      }
    } catch (error) {
      pending = false;
      onError?.(error);
      throw error;
    } finally {
      onBusyChange?.(false);
      current = null;
    }
  };

  return {
    request() {
      pending = true;
      current ||= drain();
      return current;
    },
    get running() {
      return current !== null;
    },
  };
}
