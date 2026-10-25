import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = "http://localhost:3000";

export default defineConfig({
  root: "client",
  plugins: [react()],
  build: { outDir: "../dist/client", emptyOutDir: true },
  server: { port: 5173, proxy: { "/api": api, "/health": api } },
});
