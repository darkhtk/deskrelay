import { readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { type ViteDevServer, defineConfig } from "vite";
import solid from "vite-plugin-solid";

const SITE_BACKEND_URL = process.env.CR_SITE_BACKEND_URL ?? "http://127.0.0.1:18092";
const SITE_TOKEN_FILE = process.env.CR_SITE_TOKEN_FILE ?? "";

function localAddresses(): Set<string> {
  const values = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      values.add(entry.address);
      values.add(normalizeAddress(entry.address));
      if (entry.family === "IPv4") values.add(`::ffff:${entry.address}`);
    }
  }
  return values;
}

function normalizeAddress(value: string): string {
  if (value.startsWith("::ffff:")) return value.slice("::ffff:".length);
  if (value === "::1") return "127.0.0.1";
  return value;
}

function readSiteToken(): string | null {
  try {
    if (SITE_TOKEN_FILE) {
      const token = readFileSync(SITE_TOKEN_FILE, "utf8").trim();
      if (token) return token;
    }
  } catch {
    // Fall back to the process env token below.
  }
  return process.env.CR_SITE_TOKEN?.trim() || null;
}

function deskrelayLocalTokenPlugin() {
  return {
    name: "deskrelay-local-token",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/__deskrelay/local-site-token", (req, res) => {
        const remote = req.socket.remoteAddress ?? "";
        if (!localAddresses().has(remote)) {
          res.statusCode = 403;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "local access only" }));
          return;
        }
        const token = readSiteToken();
        if (!token) {
          res.statusCode = 404;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "token not found" }));
          return;
        }
        res.setHeader("cache-control", "no-store");
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ token }));
      });
      server.middlewares.use("/__deskrelay/client-context", (req, res) => {
        const remote = req.socket.remoteAddress ?? "";
        const address = normalizeAddress(remote);
        const locals = localAddresses();
        res.setHeader("cache-control", "no-store");
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            address,
            isLocal: locals.has(remote) || locals.has(address),
          }),
        );
      });
    },
  };
}

export default defineConfig({
  plugins: [solid(), deskrelayLocalTokenPlugin()],
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
