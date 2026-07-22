import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The control-plane base URL is injected at build via VITE_CONTROL_URL, defaulting
// to the compose-mapped host port. Dev server proxies /api to the control plane.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_CONTROL_URL || "http://localhost:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
