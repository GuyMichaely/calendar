// Shown in a frame by guymichaely.com/calendar/, which keeps the address bar its own: it's told
// where the app is (its views are the address's #) so its address says the same, and refreshing or
// sharing it opens the same view. Signing in asks it to send the whole tab (@guymichaely/app-sync).
export function reportRoute() {
  if (window.parent === window || !document.referrer) return;
  const host = new URL(document.referrer).origin;
  const report = () => window.parent.postMessage({ frame: "route", hash: location.hash }, host);
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method].bind(history);
    history[method] = (...args: Parameters<History["pushState"]>) => { original(...args); report(); };
  }
  window.addEventListener("hashchange", report);
  window.addEventListener("popstate", report);
  report();
}
