import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

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
        app: "solid/index.html",
        migrateAutomerge: "solid/migrate-automerge.html",
      },
    },
  },
});
