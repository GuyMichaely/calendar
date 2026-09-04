import { defineConfig } from "vite";

export default defineConfig({
  root: "framework",
  base: "./",
  build: {
    outDir: "../site/framework",
    emptyOutDir: true,
    sourcemap: true,
  },
});
