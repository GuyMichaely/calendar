import { configureRemoteAttachments } from "../../site/attachment-remote.js";
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

type RemoteStorage = {
  readSnapshot: () => Promise<Uint8Array>;
  mergeSnapshot: (bytes: Uint8Array) => Promise<unknown>;
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

export const REMOTE_BACKEND_STORAGE_KEY = "calendar.remoteBackendUrl";

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const url = new URL(trimmed);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error("Remote sync URL must use HTTP or HTTPS.");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  url.search = "";
  url.hash = "";
  return url.href;
}

function requestError(message: string, status: number) {
  return Object.assign(new Error(`${message} (${status}).`), { status });
}

function browserBackendUrl() {
  if (typeof window === "undefined") return "";
  const saved = window.localStorage?.getItem(REMOTE_BACKEND_STORAGE_KEY);
  if (saved !== null) return saved;
  return import.meta.env?.VITE_CALENDAR_BACKEND_URL || "";
}

export function configuredBackendUrl(value = browserBackendUrl()) {
  return normalizeBaseUrl(value);
}

export function saveConfiguredBackendUrl(value: string) {
  if (typeof window === "undefined") return normalizeBaseUrl(value);
  const normalized = normalizeBaseUrl(value);
  window.localStorage.setItem(REMOTE_BACKEND_STORAGE_KEY, normalized);
  return normalized;
}

export function createRemoteCalendarClient({ backendUrl, storage, fetch: fetchImpl = globalThis.fetch }: RemoteClientOptions) {
  const baseUrl = normalizeBaseUrl(backendUrl);
  if (!baseUrl) throw new Error("Remote calendar client requires a backend URL.");
  if (typeof fetchImpl !== "function") throw new Error("Remote calendar client requires Fetch API support.");

  const endpoint = (path: string) => new URL(path.replace(/^\//u, ""), baseUrl).href;

  const uploadAttachments = async (attachments: RemoteAttachment[]) => {
    for (const attachment of attachments) {
      if (!(attachment.blob instanceof Blob)) continue;
      const url = endpoint(`attachments/${encodeURIComponent(attachment.id)}`);
      const existing = await fetchImpl(url, { method: "HEAD", credentials: "include" });
      if (existing.ok) continue;
      if (existing.status !== 404) throw requestError("Could not check remote attachment", existing.status);
      const upload = await fetchImpl(url, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": attachment.blob.type || attachment.type || "application/octet-stream" },
        body: attachment.blob,
      });
      if (!upload.ok) throw requestError("Could not upload attachment", upload.status);
    }
  };

  const downloadAttachment = async (attachment: RemoteAttachment) => {
    const response = await fetchImpl(endpoint(`attachments/${encodeURIComponent(attachment.id)}`), {
      credentials: "include",
    });
    if (!response.ok) throw requestError("Could not download attachment", response.status);
    const contentType = response.headers.get("content-type") || attachment.type || "application/octet-stream";
    return new Blob([await response.arrayBuffer()], { type: contentType });
  };

  configureRemoteAttachments({ upload: uploadAttachments, download: downloadAttachment });

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

    sync(signal?: AbortSignal) {
      return syncCalendarStorage(storage, {
        endpoint: endpoint("sync"),
        fetch: fetchImpl,
        credentials: "include",
        signal,
      });
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
