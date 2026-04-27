import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config — proxies /api/* to the local benchmark server (127.0.0.1:3055).
// In production, the same server serves dist/ as a static fallback so the
// proxy is dev-only.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3055",
        changeOrigin: false,
        secure: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          recharts: ["recharts"],
        },
      },
    },
  },
});
