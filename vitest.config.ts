import { defineConfig } from "vitest/config";

// Renderer tests are pure TS (no JSX) and run in node — no React plugin
// needed here. Kept separate from vite.config.ts because vitest 3 bundles
// its own vite copy whose Plugin types conflict with @vitejs/plugin-react
// (built for the top-level vite).
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
