import { defineConfig } from "vite";

// Static SPA. The DSP work (Phase 2+) runs in a Web Worker; Vite bundles
// `new Worker(new URL(...), { type: "module" })` automatically.
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist",
  },
  worker: {
    format: "es",
  },
  // The native/ tree (emsdk, upstream C sources) contains thousands of HTML
  // files; keep Vite's dependency scanner and file watcher out of it.
  optimizeDeps: {
    entries: ["index.html"],
  },
  server: {
    watch: {
      ignored: ["**/native/**"],
    },
  },
});
