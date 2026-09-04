import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  root: "svelte",
  base: "/calendar/svelte/",
  plugins: [svelte()],
  build: {
    outDir: "../site/svelte",
    emptyOutDir: true,
    sourcemap: true,
  },
});
