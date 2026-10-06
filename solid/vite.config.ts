import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  root: "solid",
  base: "/",
  plugins: [solid()],
  optimizeDeps: { exclude: ["@automerge/automerge"] },
  // In development, /sync goes to the Worker (bun run dev:worker), which has no Access in front.
  server: { proxy: { "/sync": { target: "http://127.0.0.1:8787", ws: true } } },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
