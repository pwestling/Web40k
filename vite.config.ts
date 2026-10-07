/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the build can be hosted under any sub-path
  // (e.g. GitHub Pages at /open-battle/).
  base: "./",
  // three.js alone is ~700 kB; split chunks once there is more than one screen.
  build: { chunkSizeWarningLimit: 2000 },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
