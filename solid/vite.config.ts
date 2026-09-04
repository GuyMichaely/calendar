import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  root: "solid",
  base: "/calendar/solid/",
  plugins: [solid()],
  build: {
    outDir: "../site/solid",
    emptyOutDir: true,
    sourcemap: true,
  },
});
