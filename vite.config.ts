/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

// The app build peers compare in game/packages: version + commit.
function build(): string {
  try {
    return `${pkg.version}+${execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim()}`;
  } catch {
    return `${pkg.version}+dev`;
  }
}

export default defineConfig({
  plugins: [react()],
  define: { __APP_BUILD__: JSON.stringify(build()) },
  // Relative asset paths so the build can be hosted under any sub-path
  // (e.g. GitHub Pages at /open-battle/).
  base: "./",
  // three.js alone is ~700 kB; split chunks once there is more than one screen.
  build: { chunkSizeWarningLimit: 2000 },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
