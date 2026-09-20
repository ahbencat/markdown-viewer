import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // KaTeX (640K) + Mermaid (3.1M) stay in public/vendor and load lazily
  // via script tags — they must never be bundled or pre-bundled.
  optimizeDeps: {
    exclude: ["markdown-it-footnote"],
  },
  server: {
    watch: {
      // cargo holds target/debug/*.exe open while compiling; letting vite
      // watch src-tauri makes the watcher hit EBUSY on Windows and kills
      // `cargo tauri dev` via a non-zero beforeDevCommand exit.
      ignored: ["**/src-tauri/**"],
    },
  },
});
