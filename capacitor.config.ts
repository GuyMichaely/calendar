import type { CapacitorConfig } from "@capacitor/cli";

// The Android app: a native shell around the calendar at calendar.guymichaely.com. It loads the
// site rather than a bundled copy, so it shares the site's Cloudflare Access sign-in (same origin,
// first-party cookie) and gets its updates without a new APK; the site's service worker (solid/sw.js)
// opens it offline. Native code changes (plugins, this file) need a new APK (.github/workflows/android.yml).
const config: CapacitorConfig = {
  appId: "com.guymichaely.calendar",
  appName: "Calendar",
  // Capacitor requires local files; the app runs from server.url.
  webDir: "dist",
  server: {
    url: "https://calendar.guymichaely.com/",
    // Signing in to Access (and through it, to Cloudflare) stays inside the app.
    allowNavigation: ["*.cloudflareaccess.com", "*.cloudflare.com"],
  },
  plugins: {
    // Light status and navigation bar icons over the app's dark background.
    SystemBars: { style: "DARK" },
  },
};

export default config;
