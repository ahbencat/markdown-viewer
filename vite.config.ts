import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // KaTeX (640K) + Mermaid (3.1M) stay in public/vendor and load lazily
  // via script tags — they must never be bundled or pre-bundled.
  optimizeDeps: {
    exclude: ["markdown-it-footnote"],
  },
});
