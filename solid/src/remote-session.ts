import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import { mergeSyncSnapshot, readSyncSnapshot } from "../../site/storage.js";
import { createRemoteCalendarClient, createRemoteSyncQueue, type RemoteSession } from "./remote-sync";

function errorMessage(error: unknown, fallback: string) { return error instanceof Error && error.message ? error.message : fallback; }

/**
 * Sign-in and sync state for the configured sync server. Syncs when asked, on an interval while the
 * page is visible, and when the page becomes visible or the browser comes back online.
 */
export function createRemoteSync(options: { backendUrl: string; pollSeconds: Accessor<number>; onSynced: () => Promise<void> }) {
  const remote = options.backendUrl ? createRemoteCalendarClient({ backendUrl: options.backendUrl, storage: { readSnapshot: readSyncSnapshot, mergeSnapshot: mergeSyncSnapshot } }) : null;
  const [remoteSession, setRemoteSession] = createSignal<RemoteSession | null>(null);
  const [remoteBusy, setRemoteBusy] = createSignal(false);
  const [remoteError, setRemoteError] = createSignal("");
  const [lastSyncedAt, setLastSyncedAt] = createSignal<Date | null>(null);

  const remoteQueue = remote ? createRemoteSyncQueue({
    sync: () => remote.sync(),
    onBusyChange: setRemoteBusy,
    onSynced: async () => { await options.onSynced(); setRemoteError(""); setLastSyncedAt(new Date()); },
    onError: (error) => {
      const status = typeof error === "object" && error !== null && "status" in error ? (error as { status?: unknown }).status : null;
      if (status === 401) setRemoteSession({ authenticated: false, identity: null });
      setRemoteError(errorMessage(error, "Remote sync failed."));
    },
  }) : null;
  /** Resolves to an error message when the sync failed, or null. */
  const requestRemoteSync = async (): Promise<string | null> => {
    if (!remoteQueue || !remoteSession()?.authenticated) return null;
    try {
      await remoteQueue.request();
      return null;
    } catch (error) {
      const message = errorMessage(error, "Remote sync failed.");
      setRemoteError(message);
      return message;
    }
  };
  const checkRemoteSession = async () => {
    if (!remote) return;
    setRemoteError("");
    try {
      const session = await remote.session();
      setRemoteSession(session);
      if (session.authenticated) await requestRemoteSync();
    } catch (error) {
      setRemoteSession(null);
      setRemoteError(errorMessage(error, "Could not reach calendar sync."));
    }
  };
  const refreshRemoteOnResume = () => {
    if (!remote) return;
    if (remoteSession()?.authenticated) void requestRemoteSync();
    else if (remoteSession() === null && remoteError()) void checkRemoteSession();
  };
  const signOutRemote = async () => {
    if (!remote) return;
    await remote.logout();
    setRemoteSession({ authenticated: false, identity: null });
    setRemoteError("");
    setLastSyncedAt(null);
  };
  const identityLabel = () => {
    const identity = remoteSession()?.identity;
    return identity?.name || identity?.email || identity?.subject || "Signed in";
  };

  createEffect(() => {
    const seconds = options.pollSeconds();
    if (!seconds) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine && !remoteBusy()) refreshRemoteOnResume();
    }, seconds * 1000);
    onCleanup(() => window.clearInterval(timer));
  });
  const syncRemoteWhenVisible = () => { if (document.visibilityState === "visible") refreshRemoteOnResume(); };
  window.addEventListener("online", refreshRemoteOnResume);
  document.addEventListener("visibilitychange", syncRemoteWhenVisible);
  onCleanup(() => {
    window.removeEventListener("online", refreshRemoteOnResume);
    document.removeEventListener("visibilitychange", syncRemoteWhenVisible);
  });

  return {
    enabled: !!remote,
    session: remoteSession,
    busy: remoteBusy,
    error: remoteError,
    lastSyncedAt,
    identityLabel,
    request: requestRemoteSync,
    checkSession: checkRemoteSession,
    signOut: signOutRemote,
    loginUrl: (returnTo: string) => remote!.loginUrl("google", returnTo),
  };
}
