import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  plugins: [preact(), tailwind()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.ARES_BRAIN_DASHBOARD_PORT || 4319}`,
        changeOrigin: true,
      },
    },
  },
  test: { globals: true, environment: "jsdom", setupFiles: ["./test/setup.ts"] },
});
