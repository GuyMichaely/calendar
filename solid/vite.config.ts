import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  root: "solid",
  base: "/calendar/",
  plugins: [solid()],
  optimizeDeps: { exclude: ["@automerge/automerge"] },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
