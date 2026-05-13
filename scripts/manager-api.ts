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
  bun run scripts/manager-api.ts batch --file requests.json

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
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
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

async function readJsonOption(options: Record<string, string | true>): Promise<unknown> {
  if (typeof options.json === "string") return JSON.parse(options.json);
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
  if (args[0] === "batch") {
    const options = parseOptions(args.slice(1));
    if (typeof options.file !== "string") usage();
    const requests = JSON.parse(await Bun.file(options.file).text()) as BatchRequest[];
    if (!Array.isArray(requests)) throw new Error("batch file must contain an array");
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
