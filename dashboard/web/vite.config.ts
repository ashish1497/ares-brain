import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.ARES_BRAIN_DASHBOARD_PORT || 4319}`,
        changeOrigin: true,
      },
    },
  },
  test: { environment: "jsdom", globals: true, setupFiles: ["./test/setup.ts"] },
});
