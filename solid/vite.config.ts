import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";

// Emits sw.js (the offline copy) with the list of this build's files.
function serviceWorker(): Plugin {
  return {
    name: "calendar-service-worker",
    apply: "build",
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter(file => !file.endsWith(".map") && file !== "index.html").sort();
      const source = readFileSync(new URL("./sw.js", import.meta.url), "utf8").replace("self.__FILES__", JSON.stringify(files));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  root: "solid",
  base: "/calendar/",
  plugins: [solid(), serviceWorker()],
  optimizeDeps: { exclude: ["@automerge/automerge"] },
  // In development, /calendar/sync goes to the Worker (bun run dev:worker), which has no Access in front.
  server: { proxy: { "/calendar/sync": { target: "http://127.0.0.1:8787", ws: true } } },
  build: {
    // The Worker serves dist, so the app sits at dist/calendar to be served at /calendar/.
    outDir: "../dist/calendar",
    emptyOutDir: true,
    sourcemap: true,
  },
});
