import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  plugins: [preact(), tailwind()],
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:4319" } },
  test: { globals: true, environment: "jsdom", setupFiles: ["./test/setup.ts"] },
});
