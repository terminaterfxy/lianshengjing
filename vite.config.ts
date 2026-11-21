import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // served from a sub-path on GitHub Pages: CHIMERA_BASE=/lianshengjing/ bun run build
  base: process.env.CHIMERA_BASE ?? "/",
  plugins: [react()],
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: true },
  server: { host: "127.0.0.1", port: 5317, strictPort: true, allowedHosts: true },
  preview: { host: "127.0.0.1", port: 5318, strictPort: true, allowedHosts: true },
});
