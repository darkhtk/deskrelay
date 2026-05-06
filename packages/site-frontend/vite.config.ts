import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

const SITE_BACKEND_URL = process.env.CR_SITE_BACKEND_URL ?? "http://127.0.0.1:18092";

export default defineConfig({
  plugins: [solid()],
  server: {
    port: 18093,
    host: "127.0.0.1",
    // Proxy /api + /healthz to the site-backend so the browser can use
    // same-origin URLs (no CORS, no env config in the page).
    proxy: {
      "/api": { target: SITE_BACKEND_URL, changeOrigin: true },
      "/healthz": { target: SITE_BACKEND_URL, changeOrigin: true },
    },
  },
});
