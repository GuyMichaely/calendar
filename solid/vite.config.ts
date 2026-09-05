import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: "solid",
  base: "/calendar/",
  plugins: [solid()],
  build: {
    outDir: "../site/solid",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        app: resolve(rootDir, "index.html"),
        migrateAutomerge: resolve(rootDir, "migrate-automerge.html"),
      },
    },
  },
});
