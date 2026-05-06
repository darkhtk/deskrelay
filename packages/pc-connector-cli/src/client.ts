// HTTP client for the daemon's local API. Thin wrapper that turns
// transport errors into typed CliClientError so commands can format
// them uniformly.

export interface CliClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /** Bearer token the local daemon requires on every HTTP route. The
   *  CLI's bin.ts reads it from auth.json (sibling of daemon.json) so
   *  the same OS user that runs the daemon can also drive it from a
   *  shell. Optional only for unit tests; production paths always
   *  pass it. */
  authToken?: string;
}

export class CliClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "CliClientError";
  }
}

export interface BehaviorSummary {
  instanceId: string;
  name: string;
  version: string;
  loadedAt: string;
}

export interface DaemonStatus {
  ok: boolean;
  startedAt: string;
  listening: { host: string; port: number };
  behaviors: BehaviorSummary[];
  brokerStats: { spaces: number; subscribers: number; bufferedEvents: number };
}

export interface BehaviorRequestSuccess<R = unknown> {
  result: R;
  error?: undefined;
}

export interface BehaviorRequestFailure {
  result?: undefined;
  error: { code: number; message: string; data?: unknown };
}

export type BehaviorRequestResult<R = unknown> = BehaviorRequestSuccess<R> | BehaviorRequestFailure;

export class CliClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #authToken: string | undefined;

  constructor(options: CliClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#fetch = options.fetchImpl ?? fetch;
    this.#authToken = options.authToken;
  }

  async status(): Promise<DaemonStatus> {
    return await this.#json<DaemonStatus>("GET", "/status");
  }

  async listBehaviors(): Promise<BehaviorSummary[]> {
    return await this.#json<BehaviorSummary[]>("GET", "/behaviors");
  }

  async loadBehavior(
    packageDir: string,
    instanceId?: string,
  ): Promise<{
    instanceId: string;
    loadedAt: string;
  }> {
    const body: Record<string, unknown> = { packageDir };
    if (instanceId !== undefined) body.instanceId = instanceId;
    return await this.#json("POST", "/behaviors/load", body);
  }

  async unloadBehavior(instanceId: string): Promise<{ ok: true }> {
    return await this.#json("DELETE", `/behaviors/${encodeURIComponent(instanceId)}`);
  }

  async requestBehavior<R = unknown>(
    instanceId: string,
    method: string,
    params?: unknown,
    timeoutMs?: number,
  ): Promise<BehaviorRequestResult<R>> {
    const body: Record<string, unknown> = { method };
    if (params !== undefined) body.params = params;
    if (timeoutMs !== undefined) body.timeoutMs = timeoutMs;
    return await this.#json("POST", `/behaviors/${encodeURIComponent(instanceId)}/request`, body);
  }

  /** Stream NDJSON-of-SSE-events for a space. Caller controls cancellation
   *  via the AbortSignal. */
  async *streamEvents(
    spaceId: string,
    options: { signal?: AbortSignal; lastEventId?: string } = {},
  ): AsyncGenerator<unknown, void, void> {
    const url = `${this.#baseUrl}/events/spaces/${encodeURIComponent(spaceId)}/stream`;
    const init: RequestInit = options.signal ? { signal: options.signal } : {};
    const headers: Record<string, string> = {};
    if (options.lastEventId) headers["Last-Event-ID"] = options.lastEventId;
    if (this.#authToken) headers.authorization = `Bearer ${this.#authToken}`;
    if (Object.keys(headers).length > 0) init.headers = headers;
    const res = await this.#fetch(url, init);
    if (!res.ok) {
      throw new CliClientError(`SSE request failed (${res.status})`, res.status);
    }
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      // Parse SSE: events are separated by blank lines; data lines start "data: ".
      while (true) {
        const blank = buffer.indexOf("\n\n");
        if (blank === -1) break;
        const block = buffer.slice(0, blank);
        buffer = buffer.slice(blank + 2);
        const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
        if (dataLine) {
          try {
            yield JSON.parse(dataLine.slice("data: ".length));
          } catch {
            // skip malformed
          }
        }
      }
    }
  }

  async #json<R = unknown>(method: string, path: string, body?: unknown): Promise<R> {
    const init: RequestInit = { method };
    const headers: Record<string, string> = {};
    if (this.#authToken) headers.authorization = `Bearer ${this.#authToken}`;
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      headers["content-type"] = "application/json";
    }
    if (Object.keys(headers).length > 0) init.headers = headers;
    let res: Response;
    try {
      res = await this.#fetch(`${this.#baseUrl}${path}`, init);
    } catch (err) {
      throw new CliClientError(
        `cannot reach daemon at ${this.#baseUrl}: ${(err as Error).message}`,
      );
    }
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      const errMsg =
        parsed && typeof parsed === "object" && "error" in parsed
          ? String((parsed as { error: unknown }).error)
          : `HTTP ${res.status}`;
      throw new CliClientError(errMsg, res.status, parsed);
    }
    return parsed as R;
  }
}
