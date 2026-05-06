// Tiny stdin reader — used by the PreToolUse hook script to capture
// the JSON claude CLI sends. Bun's process.stdin is an AsyncIterable<
// Uint8Array>; we accumulate and decode at the end. Synchronous readers
// (like Node's readFileSync(0)) would block the event loop and break
// the fetch call below them.

export async function readableStreamFromStdin(timeoutMs = 5_000): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const decoder = new TextDecoder();

  const stdin = process.stdin as unknown as AsyncIterable<Uint8Array>;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(() => {
      resolve(decoder.decode(joinChunks(chunks, total)));
    }, timeoutMs);
  });

  const reader = (async () => {
    for await (const chunk of stdin) {
      chunks.push(chunk);
      total += chunk.byteLength;
    }
    return decoder.decode(joinChunks(chunks, total));
  })();

  const result = await Promise.race([reader, timeout]);
  if (timer) clearTimeout(timer);
  return result;
}

function joinChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
