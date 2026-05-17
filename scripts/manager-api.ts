type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface BatchRequest {
  id?: string;
  method?: string;
  path?: string;
  body?: JsonValue;
}

interface ApiResult {
  id?: string;
  method: string;
  path: string;
  ok: boolean;
  status?: number;
  data?: unknown;
  text?: string;
  error?: string;
}

const args = Bun.argv.slice(2);

function usage(): never {
  console.error(`Usage:
  bun run scripts/manager-api.ts GET /api/manager/system/summary
  bun run scripts/manager-api.ts POST /api/manager/tasks --json '{"kind":"diagnose","dryRun":true}'
  bun run scripts/manager-api.ts POST /api/manager/tasks --body-file request.json
  bun run scripts/manager-api.ts batch-get summary=/api/manager/system/summary workers=/api/manager/workers
  bun run scripts/manager-api.ts batch --file requests.json
  bun run scripts/manager-api.ts batch --requests '[{"id":"summary","method":"GET","path":"/api/manager/system/summary"}]'

Environment:
  DESKRELAY_MANAGER_API_BASE  Defaults to http://127.0.0.1:18193
  DESKRELAY_SITE_TOKEN        Sent as Authorization bearer when present

Batch file shape:
  [
    { "id": "summary", "method": "GET", "path": "/api/manager/system/summary" },
    { "id": "workers", "method": "GET", "path": "/api/manager/workers" }
  ]`);
  process.exit(2);
}

function baseUrl(): string {
  return (process.env.DESKRELAY_MANAGER_API_BASE || "http://127.0.0.1:18193").replace(/\/+$/, "");
}

function endpoint(path: string): string {
  const normalizedPath = normalizeApiPath(path);
  if (/^https?:\/\//i.test(normalizedPath)) return normalizedPath;
  return `${baseUrl()}${normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`}`;
}

function normalizeApiPath(path: string): string {
  const trimmed = path.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const slashPath = trimmed.replace(/\\/g, "/");
  const apiIndex = slashPath.indexOf("/api/");
  if (apiIndex > 0) return slashPath.slice(apiIndex);
  if (slashPath.startsWith("api/")) return `/${slashPath}`;
  return trimmed;
}

function parseOptions(raw: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let index = 0; index < raw.length; index += 1) {
    const arg = raw[index];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq > 0) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = raw[index + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      index += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function parseJsonArgument(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (text.includes('\\"')) {
      try {
        return JSON.parse(text.replace(/\\"/g, '"'));
      } catch {
        // Preserve the original, more accurate JSON parser error.
      }
    }
    throw error;
  }
}

async function readJsonOption(options: Record<string, string | true>): Promise<unknown> {
  if (typeof options.json === "string") return parseJsonArgument(options.json);
  if (typeof options["body-file"] === "string") {
    return JSON.parse(await Bun.file(options["body-file"]).text());
  }
  return undefined;
}

async function callApi(input: BatchRequest): Promise<ApiResult> {
  const method = (input.method || "GET").toUpperCase();
  const path = input.path;
  if (!path) {
    return {
      ...(input.id ? { id: input.id } : {}),
      method,
      path: "",
      ok: false,
      error: "missing path",
    };
  }
  const headers: Record<string, string> = { accept: "application/json" };
  const token = process.env.DESKRELAY_SITE_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  const init: RequestInit = { method, headers };
  if (input.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(input.body);
  }
  try {
    const response = await fetch(endpoint(path), init);
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    const parsed = contentType.includes("application/json") && text ? JSON.parse(text) : undefined;
    const base = {
      ...(input.id ? { id: input.id } : {}),
      method,
      path,
      ok: response.ok,
      status: response.status,
    };
    if (response.ok) {
      return parsed !== undefined ? { ...base, data: parsed } : { ...base, text };
    }
    return {
      ...base,
      ...(parsed !== undefined ? { data: parsed } : { text }),
      error: `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ...(input.id ? { id: input.id } : {}),
      method,
      path,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main(): Promise<number> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") usage();
  if (args[0] === "batch-get") {
    const requests: BatchRequest[] = args.slice(1).map((entry, index) => {
      const separator = entry.indexOf("=");
      if (separator > 0) {
        return {
          id: entry.slice(0, separator),
          method: "GET",
          path: entry.slice(separator + 1),
        };
      }
      return { id: `get_${index + 1}`, method: "GET", path: entry };
    });
    if (requests.length === 0) usage();
    const results = await Promise.all(requests.map((request) => callApi(request)));
    console.log(JSON.stringify({ ok: results.every((result) => result.ok), results }, null, 2));
    return 0;
  }
  if (args[0] === "batch") {
    const options = parseOptions(args.slice(1));
    const requests =
      typeof options.requests === "string"
        ? (parseJsonArgument(options.requests) as BatchRequest[])
        : typeof options.file === "string"
          ? (JSON.parse(await Bun.file(options.file).text()) as BatchRequest[])
          : undefined;
    if (!requests) usage();
    if (!Array.isArray(requests)) throw new Error("batch input must contain an array");
    const results = await Promise.all(requests.map((request) => callApi(request)));
    console.log(JSON.stringify({ ok: results.every((result) => result.ok), results }, null, 2));
    return 0;
  }

  const method = args[0]?.toUpperCase();
  const path = args[1];
  if (!method || !path) usage();
  const options = parseOptions(args.slice(2));
  const body = await readJsonOption(options);
  const result = await callApi({
    method,
    path,
    ...(body !== undefined ? { body: body as JsonValue } : {}),
  });
  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(
      JSON.stringify(
        { ok: false, error: error instanceof Error ? error.message : String(error) },
        null,
        2,
      ),
    );
    process.exit(1);
  });
