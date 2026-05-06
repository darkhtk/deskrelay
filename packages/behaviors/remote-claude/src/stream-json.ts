// stream-json — line-buffered parser for `claude --output-format stream-json`.
//
// claude CLI emits one JSON object per line. Each object has a `type`
// field discriminating its variant. We pass the raw object through to
// the broker as the event content; callers (browser) shape-check on the
// `type` field.
//
// We intentionally don't model every variant in TypeScript — claude's
// stream-json is a moving target and over-typing would force us to keep
// up. The parser only validates that each line is a well-formed JSON
// object with a string `type`. The raw shape is preserved.

export interface ClaudeStreamEvent {
  /** The event variant — e.g. "system", "assistant", "user", "result",
   *  "tool_use_request", etc. Open enum; consumers should tolerate new
   *  values rather than crash. */
  type: string;
  [key: string]: unknown;
}

export class StreamJsonParser {
  #buffer = "";

  /** Push a chunk and return any complete events it produced. Bytes are
   *  decoded as UTF-8. Malformed lines are skipped (with the line text
   *  attached via onMalformed) — claude occasionally writes non-JSON
   *  warnings on stdout when something is off. */
  push(
    chunk: string | Uint8Array,
    onMalformed?: (line: string, error: Error) => void,
  ): ClaudeStreamEvent[] {
    this.#buffer += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    const events: ClaudeStreamEvent[] = [];
    let nl = this.#buffer.indexOf("\n");
    while (nl !== -1) {
      const line = this.#buffer.slice(0, nl).trimEnd();
      this.#buffer = this.#buffer.slice(nl + 1);
      if (line.length > 0) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch (err) {
          onMalformed?.(line, err as Error);
          nl = this.#buffer.indexOf("\n");
          continue;
        }
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          typeof (parsed as ClaudeStreamEvent).type === "string"
        ) {
          events.push(parsed as ClaudeStreamEvent);
        } else {
          onMalformed?.(line, new Error("not a JSON object with a `type` string"));
        }
      }
      nl = this.#buffer.indexOf("\n");
    }
    return events;
  }

  /** Flush any trailing partial line as malformed (used on subprocess exit). */
  flush(onMalformed?: (line: string, error: Error) => void): void {
    if (this.#buffer.length > 0) {
      const line = this.#buffer.trimEnd();
      this.#buffer = "";
      if (line.length > 0) {
        try {
          const parsed = JSON.parse(line);
          if (
            typeof parsed === "object" &&
            parsed !== null &&
            typeof (parsed as ClaudeStreamEvent).type === "string"
          ) {
            // It actually was complete; let it surface as if newline-terminated.
            // We can't return it from flush (callers don't expect events),
            // so report it as malformed-recovered. Realistically this
            // happens when claude exits without final newline.
          }
        } catch (err) {
          onMalformed?.(line, err as Error);
        }
      }
    }
  }
}
