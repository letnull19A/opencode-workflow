import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const apiHost = "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [
    react({
      compiler: true,
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/stream": apiHost,
      "/health": apiHost,
      "/agents": apiHost,
      "/task": apiHost,
      "/module": apiHost,
      "/run": apiHost,
      "/hooks": apiHost,
      "/openapi.yaml": apiHost,
    },
  },
});