// InProcessSubscriptionBroker — the kernel's pub/sub primitive.
//
// Each space holds a bounded ring buffer (default 1024 events). Subscribers
// can join with `since` to receive missed events first (replay), then live
// events as they arrive. SSE / websocket transports translate
// `Last-Event-ID` headers into `since` cursors.
//
// Cursors are strings holding decimal-encoded monotonic ints, per space.
// We use strings (not bigints) because event ids leave the process via JSON
// and HTTP headers where number precision is unsafe past 2^53.
//
// Concurrency model: this broker assumes a single-threaded event loop
// (Node, Bun, or Workers isolate). Multiple in-flight publishes serialize
// naturally; we don't take locks.

import type { EventEnvelope, EventInput } from "@claude-remote/shared/event";
import { type SpaceId, isSpaceId } from "@claude-remote/shared/space";

const DEFAULT_BACKLOG_PER_SPACE = 1024;

interface SpaceState {
  /** ring buffer of recent envelopes, oldest at index 0. */
  buffer: EventEnvelope[];
  /** monotonic per-space sequence counter. Stringified to form ids. */
  nextSeq: bigint;
  /** active subscribers; iterated in insertion order. */
  subscribers: Set<Subscriber>;
}

type Subscriber = (env: EventEnvelope) => void;

export interface BrokerOptions {
  backlogPerSpace?: number;
  /** override for testing (default: () => new Date().toISOString()) */
  now?: () => string;
}

export interface SubscribeOptions {
  /** if set, broker replays envelopes with cursor strictly greater than this. */
  since?: string;
  /** Replay the current backlog before subscribing when no cursor is known.
   *  Useful for short-lived run streams where the HTTP/SSE subscription
   *  can arrive just after the first event was published. Ignored when
   *  `since` is set because cursor replay is more precise. */
  replayBacklog?: boolean;
}

export interface Subscription {
  /** stop receiving events. Idempotent. */
  unsubscribe(): void;
}

export class InProcessSubscriptionBroker {
  readonly #spaces = new Map<SpaceId, SpaceState>();
  readonly #backlogPerSpace: number;
  readonly #now: () => string;

  constructor(options: BrokerOptions = {}) {
    this.#backlogPerSpace = options.backlogPerSpace ?? DEFAULT_BACKLOG_PER_SPACE;
    if (this.#backlogPerSpace < 1) {
      throw new Error("backlogPerSpace must be >= 1");
    }
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  /** Publish a single event to its declared spaceId. Returns the envelope
   *  the broker stamped (with id, cursor, createdAt set).
   *
   *  If you want fan-out across multiple spaces, call publish() multiple
   *  times — each space carries its own cursor sequence. */
  publish<T>(input: EventInput<T>): EventEnvelope<T> {
    if (!isSpaceId(input.spaceId)) {
      throw new Error(`publish: invalid spaceId ${JSON.stringify(input.spaceId)}`);
    }
    const state = this.#getOrCreateSpace(input.spaceId);
    const seq = state.nextSeq;
    state.nextSeq = seq + 1n;
    const envelope: EventEnvelope<T> = {
      ...input,
      id: seq.toString(),
      cursor: seq.toString(),
      createdAt: this.#now(),
    };
    state.buffer.push(envelope);
    if (state.buffer.length > this.#backlogPerSpace) {
      state.buffer.shift();
    }
    for (const sub of state.subscribers) {
      try {
        sub(envelope);
      } catch {
        // Subscriber callbacks must not throw into the publisher's stack.
        // We swallow and rely on the subscriber's own error handling.
      }
    }
    return envelope;
  }

  /** Subscribe to a space. Replays anything strictly after `since` (if any
   *  is provided and is still in the buffer), then forwards live events.
   *
   *  Replayed envelopes arrive synchronously inside the subscribe() call,
   *  before subscribe() returns. Use this to populate caller state up to
   *  the live cutoff before yielding control back to the runtime. */
  subscribe(spaceId: SpaceId, sub: Subscriber, options: SubscribeOptions = {}): Subscription {
    if (!isSpaceId(spaceId)) {
      throw new Error(`subscribe: invalid spaceId ${JSON.stringify(spaceId)}`);
    }
    const state = this.#getOrCreateSpace(spaceId);
    if (options.since !== undefined) {
      const sinceBig = parseSeqOrThrow(options.since);
      for (const envelope of state.buffer) {
        if (parseSeqOrThrow(envelope.cursor) > sinceBig) {
          try {
            sub(envelope);
          } catch {
            // Same swallow rationale as publish.
          }
        }
      }
    } else if (options.replayBacklog) {
      for (const envelope of state.buffer) {
        try {
          sub(envelope);
        } catch {
          // Same swallow rationale as publish.
        }
      }
    }
    state.subscribers.add(sub);
    return {
      unsubscribe: () => {
        state.subscribers.delete(sub);
      },
    };
  }

  /** Read backlog without subscribing — used by health probes / tests. */
  backlog(spaceId: SpaceId): readonly EventEnvelope[] {
    const state = this.#spaces.get(spaceId);
    return state ? [...state.buffer] : [];
  }

  /** Diagnostic — count of currently-known spaces and total subscribers. */
  stats(): { spaces: number; subscribers: number; bufferedEvents: number } {
    let subscribers = 0;
    let bufferedEvents = 0;
    for (const state of this.#spaces.values()) {
      subscribers += state.subscribers.size;
      bufferedEvents += state.buffer.length;
    }
    return { spaces: this.#spaces.size, subscribers, bufferedEvents };
  }

  #getOrCreateSpace(spaceId: SpaceId): SpaceState {
    let state = this.#spaces.get(spaceId);
    if (!state) {
      state = { buffer: [], nextSeq: 0n, subscribers: new Set() };
      this.#spaces.set(spaceId, state);
    }
    return state;
  }
}

function parseSeqOrThrow(cursor: string): bigint {
  if (!/^\d+$/.test(cursor)) {
    throw new Error(`invalid cursor: ${JSON.stringify(cursor)}`);
  }
  return BigInt(cursor);
}
