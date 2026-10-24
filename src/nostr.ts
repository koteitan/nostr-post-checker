// rx-nostr wrappers. All relay communication goes through these.
import {
  createRxNostr,
  createRxBackwardReq,
  nip07Signer,
  noopSigner,
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
  const opened = new Set<string>(); // relays that reached the connected state
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
      next: (packet) => h.onEvent(packet.from, packet.event),
      // Deferred: the EOSE that completes use() may not have reached the
      // all-message subscriber below yet, and that relay must not become noreply.
      complete: () => setTimeout(finalize, 0),
      error: () => setTimeout(finalize, 0),
    })
  );

  // Decide on the raw message stream, where one relay's EVENT and EOSE arrive in
  // the order the relay sent them (use() could deliver the EVENT after the EOSE).
  subs.push(
    rxNostr.createAllMessageObservable().subscribe((pkt) => {
      if (pkt.type === "EVENT") {
        log("event: " + pkt.from + "\n");
        if (matches(pkt.event)) decide(pkt.from, "exist");
      } else if (pkt.type === "EOSE") {
        log("eose : " + pkt.from + "\n");
        decide(pkt.from, "notexist");
      }
    })
  );

  subs.push(
    rxNostr.createConnectionStateObservable().subscribe((pkt) => {
      const key = relayKey(pkt.from);
      if (pkt.state === "connected") {
        opened.add(key);
      } else if (pkt.state === "error" || pkt.state === "rejected") {
        // Never connected: it could not be opened. Closed after connecting: the
        // REQ went out but no EOSE came back.
        const wasOpen = opened.has(key);
        log((wasOpen ? "closed: " : "error: ") + pkt.from + "\n");
        decide(pkt.from, wasOpen ? "noreply" : "error");
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

export type DeleteResult = "accepted" | "rejected" | "error" | "noresponse";

export interface DeleteRequestHandlers {
  // Result of a relay:
  //   accepted   - the relay answered OK true
  //   rejected   - the relay answered OK false (notice = its reason)
  //   error      - the connection could not be opened, so nothing was sent
  //   noresponse - sent, but no OK came back before the timeout or the
  //                connection closed after sending
  // Called once per relay, except that a relay answering OK again (around
  // NIP-42 AUTH) updates its result.
  onResult: (relay: string, result: DeleteResult, notice?: string) => void;
  // Called once, when every relay has its final result or the wait timed out.
  onComplete: () => void;
  // Called when nothing could be sent, e.g. the NIP-07 signing was refused.
  onError: (err: unknown) => void;
}

// Send a NIP-09 deletion request (kind:5) for `eventId` to `relays`, signed by
// the NIP-07 extension. It only asks the relays; each relay decides whether to
// delete. `kind` adds the optional "k" tag when known.
export function sendDeleteRequest(
  relays: string[],
  eventId: string,
  kind: number | undefined,
  okTimeoutMs: number,
  h: DeleteRequestHandlers
): () => void {
  const tags: string[][] = [["e", eventId]];
  if (kind !== undefined) tags.push(["k", String(kind)]);

  const keys = new Set(relays.map(relayKey));
  const shown = new Set<string>(); // relays with a reported result
  const final = new Set<string>(); // relays whose result can no longer change
  const opened = new Set<string>(); // relays that reached the connected state

  let rxNostr: ReturnType<typeof createRxNostr> | undefined;
  const subs: Sub[] = [];
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    for (const s of subs) {
      try {
        s.unsubscribe();
      } catch (e) {
        /* ignore */
      }
    }
    try {
      rxNostr?.dispose();
    } catch (e) {
      /* ignore */
    }
    h.onComplete();
  };

  const report = (relay: string, result: DeleteResult, isFinal: boolean, notice?: string) => {
    if (done) return;
    const key = relayKey(relay);
    if (final.has(key)) return;
    // a connection problem after an OK does not change what the relay answered
    const keep = shown.has(key) && (result === "error" || result === "noresponse");
    if (!keep) {
      shown.add(key);
      h.onResult(relay, result, notice);
    }
    if (isFinal || keep) final.add(key);
    for (const k of keys) if (!final.has(k)) return;
    finish();
  };
  const timeoutRest = () => {
    for (const r of relays) report(r, "noresponse", true);
    finish();
  };

  // Sign first: rx-nostr's send() completes silently when signing fails, so a
  // refused NIP-07 signature could not be reported otherwise. The signed event
  // is then passed through unchanged by noopSigner().
  nip07Signer()
    .signEvent({ kind: 5, content: "", tags })
    .then(
      (signed) => {
        if (done) return;
        rxNostr = createRxNostr({
          verifier: noopVerifier,
          skipVerify: true,
          signer: noopSigner(),
          retry: { strategy: "off" },
          skipFetchNip11: true,
          okTimeout: okTimeoutMs,
        });
        subs.push(
          rxNostr.createConnectionStateObservable().subscribe((pkt) => {
            const key = relayKey(pkt.from);
            if (pkt.state === "connected") {
              opened.add(key);
            } else if (pkt.state === "error" || pkt.state === "rejected") {
              // no retry is configured, so no OK can come after this
              report(pkt.from, opened.has(key) ? "noresponse" : "error", true);
            }
          })
        );
        subs.push(
          rxNostr.send(signed, { on: { relays }, errorOnTimeout: false }).subscribe({
            // `done` false: the relay may answer once more (after NIP-42 AUTH)
            next: (p) => report(p.from, p.ok ? "accepted" : "rejected", p.ok || p.done, p.notice),
            complete: () => timeoutRest(),
            error: () => timeoutRest(),
          })
        );
      },
      (e) => {
        h.onError(e);
        finish();
      }
    );

  return finish;
}
