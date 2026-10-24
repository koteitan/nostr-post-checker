// rx-nostr wrappers. All relay communication goes through these.
import {
  createRxNostr,
  createRxBackwardReq,
  noopVerifier,
  type EventPacket,
  type LazyFilter,
} from "rx-nostr";

export type NostrEvent = EventPacket["event"];
export type RelayResult = "exist" | "notexist" | "error" | "noreply";

type Sub = { unsubscribe(): void };

// Canonical key of a relay URL, used to match rows against the `from` field of
// packets: parsed by URL (lower-cases scheme/host), no fragment, no trailing "/".
export function relayKey(url: string): string {
  try {
    const u = new URL(url.trim());
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.protocol}//${u.host}${path}${u.search}`;
  } catch (e) {
    return url.trim();
  }
}

function newRxNostr(relays: string[], eoseTimeoutMs: number) {
  const rxNostr = createRxNostr({
    // This app only checks existence, like the original (no signature check).
    verifier: noopVerifier,
    skipVerify: true,
    // One-shot queries: don't auto-reconnect, so a dead relay reports `error`
    // on the first failure instead of after a backoff chain.
    retry: { strategy: "off" },
    // One REQ per relay can't hit NIP-11 concurrency limits, so skip the extra
    // HTTP fetch of relay info (the original only used WebSocket).
    skipFetchNip11: true,
    eoseTimeout: eoseTimeoutMs,
  });
  rxNostr.setDefaultRelays(relays);
  return rxNostr;
}

export interface CheckHandlers {
  // Called for every event received, tagged with the relay it came from (for preview).
  onEvent: (relay: string, ev: NostrEvent) => void;
  // Called once per relay with its decided result.
  onResult: (relay: string, result: RelayResult) => void;
  // Called once when every relay has been decided (all EOSE / timeout).
  onComplete: () => void;
  // Optional debug line sink.
  log?: (msg: string) => void;
}

// Check on which relays an event matching `filter` exists. `matches` applies the
// stricter id/kind check the UI needs. Returns a dispose() to abort early.
export function checkEventOnRelays(
  relays: string[],
  filter: LazyFilter,
  matches: (ev: NostrEvent) => boolean,
  eoseTimeoutMs: number,
  h: CheckHandlers
): () => void {
  const rxNostr = newRxNostr(relays, eoseTimeoutMs);
  const rxReq = createRxBackwardReq();
  const subs: Sub[] = [];
  const decided = new Set<string>();
  let finished = false;

  const log = (m: string) => h.log && h.log(m);

  // Keyed by relayKey() so the raw URL (used at finalize) and the normalized
  // `from` of packets refer to the same relay.
  const decide = (relay: string, result: RelayResult) => {
    const key = relayKey(relay);
    if (decided.has(key)) return;
    decided.add(key);
    h.onResult(relay, result);
  };

  const finalize = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    for (const relay of relays) decide(relay, "noreply");
    for (const s of subs) {
      try {
        s.unsubscribe();
      } catch (e) {
        /* ignore */
      }
    }
    try {
      rxNostr.dispose();
    } catch (e) {
      /* ignore */
    }
    h.onComplete();
  };

  subs.push(
    rxNostr.use(rxReq).subscribe({
      next: (packet) => {
        log("event: " + packet.from + "\n");
        h.onEvent(packet.from, packet.event);
        if (matches(packet.event)) decide(packet.from, "exist");
      },
      complete: () => finalize(),
      error: () => finalize(),
    })
  );

  subs.push(
    rxNostr.createAllMessageObservable().subscribe((pkt) => {
      if (pkt.type === "EOSE") {
        log("eose : " + pkt.from + "\n");
        decide(pkt.from, "notexist");
      }
    })
  );

  subs.push(
    rxNostr.createConnectionStateObservable().subscribe((pkt) => {
      if (pkt.state === "error" || pkt.state === "rejected") {
        log("error: " + pkt.from + "\n");
        decide(pkt.from, "error");
      }
    })
  );

  rxReq.emit(filter);
  rxReq.over();

  const timer = setTimeout(finalize, eoseTimeoutMs + 3000);

  return finalize;
}

// Fetch the newest kind:0 of a pubkey and report its parsed content.
export function fetchProfile(
  relays: string[],
  pubkey: string,
  eoseTimeoutMs: number,
  onProfile: (content: Record<string, unknown>) => void
): () => void {
  const rxNostr = newRxNostr(relays, eoseTimeoutMs);
  const rxReq = createRxBackwardReq();
  let newest = 0;
  let done = false;

  const cleanup = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    try {
      sub.unsubscribe();
    } catch (e) {
      /* ignore */
    }
    try {
      rxNostr.dispose();
    } catch (e) {
      /* ignore */
    }
  };

  const sub = rxNostr.use(rxReq).subscribe({
    next: (packet) => {
      const ev = packet.event;
      if (ev.created_at > newest) {
        newest = ev.created_at;
        try {
          onProfile(JSON.parse(ev.content));
        } catch (e) {
          /* ignore malformed content */
        }
      }
    },
    complete: () => cleanup(),
    error: () => cleanup(),
  });

  const timer = setTimeout(cleanup, eoseTimeoutMs + 3000);

  rxReq.emit({ authors: [pubkey], kinds: [0], limit: 1 });
  rxReq.over();

  return cleanup;
}

// Fetch a relay list (kind:3 or kind:10002) for a pubkey from bootstrap relays.
// Returns the relay URLs of the newest event, or `fallback` if none found.
export function fetchRelayList(
  bootstrapRelays: string[],
  pubkey: string,
  kind: number,
  eoseTimeoutMs: number,
  fallback: string[]
): Promise<string[]> {
  return new Promise((resolve) => {
    const rxNostr = newRxNostr(bootstrapRelays, eoseTimeoutMs);
    const rxReq = createRxBackwardReq();
    let latest = { time: 0, relays: fallback };
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        sub.unsubscribe();
      } catch (e) {
        /* ignore */
      }
      try {
        rxNostr.dispose();
      } catch (e) {
        /* ignore */
      }
      resolve(latest.relays);
    };

    const sub = rxNostr.use(rxReq).subscribe({
      next: (packet) => {
        const ev = packet.event;
        if (ev.created_at <= latest.time) return;
        let rl: string[] = [];
        if (kind === 3) {
          try {
            rl = Object.keys(JSON.parse(ev.content));
          } catch (e) {
            rl = [];
          }
        } else if (kind === 10002) {
          rl = ev.tags
            .filter((t) => t[0] === "r" && typeof t[1] === "string")
            .map((t) => t[1]);
        }
        latest = { time: ev.created_at, relays: rl };
      },
      complete: () => finish(),
      error: () => finish(),
    });

    const timer = setTimeout(finish, eoseTimeoutMs + 2000);

    rxReq.emit({ kinds: [kind], authors: [pubkey], limit: 1 });
    rxReq.over();
  });
}
