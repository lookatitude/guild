/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// qa T4 — coverage gate per `.guild/plan/benchmark-factory-p2.md` lane T4-qa:
// ≥ 80 % lines + branches on `benchmark/ui/src/*`. Excludes the entry point
// (main.tsx), the Vite ambient declarations (vite-env.d.ts), and the test
// + fixture files themselves.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    environment: "happy-dom",
    globals: false,
    setupFiles: ["./src/__tests__/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src/**/__tests__/**",
        "src/**/*.test.{ts,tsx}",
        "node_modules/**",
        "coverage/**",
        "dist/**",
      ],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
