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

type RemoteStorage = {
  readSnapshot: () => Promise<Uint8Array>;
  mergeSnapshot: (bytes: Uint8Array) => Promise<unknown>;
};

type RemoteClientOptions = {
  backendUrl: string;
  storage: RemoteStorage;
  fetch?: typeof fetch;
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

export function configuredBackendUrl(value = import.meta.env.VITE_CALENDAR_BACKEND_URL || "") {
  return normalizeBaseUrl(value);
}

export function createRemoteCalendarClient({ backendUrl, storage, fetch: fetchImpl = globalThis.fetch }: RemoteClientOptions) {
  const baseUrl = normalizeBaseUrl(backendUrl);
  if (!baseUrl) throw new Error("Remote calendar client requires a backend URL.");
  if (typeof fetchImpl !== "function") throw new Error("Remote calendar client requires Fetch API support.");

  const endpoint = (path: string) => new URL(path.replace(/^\//u, ""), baseUrl).href;

  return {
    loginUrl(provider = "google") {
      return endpoint(`auth/login/${encodeURIComponent(provider)}`);
    },

    async session(): Promise<RemoteSession> {
      const response = await fetchImpl(endpoint("auth/me"), { credentials: "include" });
      if (response.status === 401) return { authenticated: false, identity: null };
      if (!response.ok) throw new Error(`Could not check calendar login (${response.status}).`);
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
      if (!response.ok) throw new Error(`Could not sign out (${response.status}).`);
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
