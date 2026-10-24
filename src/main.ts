import { parseTimestamp, parseKinds } from "./timestamp";
import { decodeNip19 } from "./nip19";
import {
  checkEventOnRelays,
  fetchProfile,
  fetchRelayList,
  relayKey,
  sendDeleteRequest,
  type DeleteResult,
  type NostrEvent,
  type RelayResult,
} from "./nostr";
import type { LazyFilter } from "rx-nostr";

const version = "1.54";

// ---- timeouts (ms) ----
const CHECK_EOSE_TIMEOUT = 60000; // matches the original 60s overall timeout
const PROFILE_EOSE_TIMEOUT = 5000;
const RELAYLIST_EOSE_TIMEOUT = 5000;
const DELETE_OK_TIMEOUT = 15000;

// ---- defaults ----
const defaultset = {
  mypubkey: "4c5d5379a066339c88f6e101e3edb1fbaee4ede3eea35ffc6f1c664b3a4383ee",
  eid: "note15zl6ruufd5hcj0xmhq9r8yczjy2xt278qzn97e9zuc3dg36lkufq4326xp",
  // cf. https://docs.google.com/spreadsheets/d/16PPbdUiGhcgsSmZueio3CbjF95_11sKDgOGN0r9LBJ0/edit#gid=0
  relaylist: [
    // global relays (supported by more than 2 clients on 2023/8/6)
    "wss://nos.lol",
    "wss://relay.damus.io",
    "wss://relay.snort.social",
    "wss://nostr-pub.wellorder.net",
    "wss://relay.nostr.band",
    // japanese relays (supported by more than 2 clients on 2023/8/6)
    "wss://yabu.me",
    "wss://relay-jp.nostr.wirednet.jp",
    "wss://nostr-relay.nokotaro.com",
    "wss://nostr.holybea.com",
  ],
  // bootstrap relays for relay list (kind:10002/3) discovery
  bootstraprelaylist: [
    "wss://directory.yabu.me",
    "wss://purplepag.es",
    "wss://user.kindpag.es",
    "wss://indexer.coracle.social",
  ],
};

// ---- localStorage namespace helpers ----
// All persistent data of this app lives in a single key "nostr-post-checker:state"
// because github.io shares one origin among all the sites. Legacy keys
// ("settings"/"darkmode"/"mypubkey") are read as a fallback only and never removed.
const LS_NS = "nostr-post-checker";
interface AppState {
  settings?: string;
  darkmode?: boolean | string;
  mypubkey?: string;
  [k: string]: unknown;
}
const lsKey = (name: string) => LS_NS + ":" + name;
function loadLegacyState(): AppState {
  const st: AppState = {};
  try {
    const settings = localStorage.getItem("settings");
    if (settings !== null) st.settings = settings;
    const darkmode = localStorage.getItem("darkmode");
    if (darkmode !== null) st.darkmode = darkmode === "true";
    const mypubkey = localStorage.getItem("mypubkey");
    if (mypubkey !== null) st.mypubkey = mypubkey;
  } catch (e) {
    /* ignore */
  }
  return st;
}
function loadState(): AppState {
  try {
    const raw = localStorage.getItem(lsKey("state"));
    if (raw !== null) {
      const st = JSON.parse(raw);
      if (st !== null && typeof st === "object") return st as AppState;
    }
  } catch (e) {
    /* ignore */
  }
  return loadLegacyState();
}
function saveState(state: AppState) {
  try {
    localStorage.setItem(lsKey("state"), JSON.stringify(state));
  } catch (e) {
    /* ignore */
  }
}
function updateState(patch: AppState) {
  const st = loadState();
  for (const k in patch) st[k] = patch[k];
  saveState(st);
}

// ---- DOM helpers ----
function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
function named<T extends HTMLElement = HTMLElement>(name: string): T {
  return document.querySelector(`[name="${name}"]`) as T;
}
const isJa = () => navigator.language === "ja";

function escape_html(s: string): string {
  if (typeof s !== "string") return s;
  return s.replace(/[&'`"<>]/g, (match) => {
    return (
      {
        "&": "&amp;",
        "'": "&#x27;",
        "`": "&#x60;",
        '"': "&quot;",
        "<": "&lt;",
        ">": "&gt;",
      } as Record<string, string>
    )[match];
  });
}

function print(m: string) {
  const d = named<HTMLTextAreaElement>("debugout");
  if (d) d.value += m;
}

// ---- i18n / show toggles ----
function initHtml(lang: string) {
  const ja = Array.from(document.getElementsByClassName("langja")) as HTMLElement[];
  const en = Array.from(document.getElementsByClassName("langen")) as HTMLElement[];
  if (lang === "ja") {
    ja.forEach((x) => (x.style.display = "inline"));
    en.forEach((x) => (x.style.display = "none"));
  } else {
    en.forEach((x) => (x.style.display = "inline"));
    ja.forEach((x) => (x.style.display = "none"));
  }
}
function showform() {
  const on = named<HTMLInputElement>("formcheck").checked;
  (Array.from(document.getElementsByClassName("inputform")) as HTMLElement[]).forEach(
    (x) => (x.style.display = on ? "block" : "none")
  );
}
function showpv() {
  const on = named<HTMLInputElement>("pvcheck").checked;
  (Array.from(document.getElementsByClassName("divpvnote")) as HTMLElement[]).forEach(
    (x) => (x.style.display = on ? "block" : "none")
  );
}
function showdebug() {
  const on = named<HTMLInputElement>("debugcheck").checked;
  (Array.from(document.getElementsByClassName("debugout")) as HTMLElement[]).forEach(
    (x) => (x.style.display = on ? "block" : "none")
  );
}

// ---- top-right pulldown menu ----
function toggleMenu() {
  const p = el("menupanel");
  p.style.display = p.style.display === "none" || p.style.display === "" ? "block" : "none";
}

// ---- dark mode ----
function applyDark(isDark: boolean) {
  if (isDark) document.body.classList.add("dark");
  else document.body.classList.remove("dark");
  const cb = document.getElementById("darkcheck") as HTMLInputElement | null;
  if (cb) cb.checked = isDark;
}
function toggleDark() {
  const isDark = el<HTMLInputElement>("darkcheck").checked;
  updateState({ darkmode: isDark });
  applyDark(isDark);
}

// ---- reset localStorage ----
// Only this app's keys ("nostr-post-checker:*") are removed. localStorage.clear()
// must not be used: github.io is a single origin shared with all the other sites.
function resetLocalStorage() {
  const msg = isJa() ? "localStorage をリセットしますか？" : "Reset localStorage?";
  if (confirm(msg)) {
    try {
      const prefix = LS_NS + ":";
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k !== null && k.indexOf(prefix) === 0) keys.push(k);
      }
      for (const k of keys) localStorage.removeItem(k);
      // Write an empty state so loadState() does not fall back to the pre-namespace
      // keys (settings / darkmode / mypubkey), which are kept on purpose.
      saveState({});
    } catch (e) {
      /* ignore */
    }
    location.reload();
  }
}

// ---- NIP-07 account display ----
function initAccount() {
  const pubkey = loadState().mypubkey;
  if (pubkey) {
    fetch_my_profile(pubkey);
  } else {
    el("accname").textContent = isJa() ? "NIP-07でログイン" : "Login with NIP-07";
  }
}
async function login_nip07() {
  const nameel = el("accname");
  try {
    const w = window as unknown as { nostr?: any; alby?: any };
    let pubkey: string;
    if (w.nostr && w.nostr.getPublicKey) {
      pubkey = await w.nostr.getPublicKey();
    } else if (w.alby) {
      pubkey = await w.alby.nostr.getPublicKey();
    } else {
      nameel.textContent = isJa() ? "NIP-07拡張がありません" : "No NIP-07 extension";
      return;
    }
    updateState({ mypubkey: pubkey });
    nameel.textContent = isJa() ? "読み込み中..." : "loading...";
    fetch_my_profile(pubkey);
  } catch (e) {
    print("nip07 login error: " + e + "\n");
    nameel.textContent = isJa() ? "ログイン失敗" : "login failed";
  }
}
function fetch_my_profile(pubkey: string) {
  fetchProfile(defaultset.relaylist, pubkey, PROFILE_EOSE_TIMEOUT, (content) => {
    update_account(
      (content.picture as string) || "",
      (content.display_name as string) || (content.name as string) || ""
    );
  });
}
function update_account(pic: string, disp: string) {
  const icon = el<HTMLImageElement>("accicon");
  if (pic) {
    icon.src = pic;
    icon.style.display = "inline-block";
  } else {
    icon.style.display = "none";
  }
  el("accname").innerHTML = disp ? escape_html(disp) : "(no name)";
}

// ---- preview ----
let pvnotetime = 0;
let profileRequested = false;
let currentProfileDispose: (() => void) | null = null;

function pvevent(ev: NostrEvent) {
  if (ev.created_at !== undefined && ev.created_at > pvnotetime) {
    pvnotetime = ev.created_at;
    el("pvtime").innerHTML = String(new Date(ev.created_at * 1000));
    let str = "";
    if (ev.content !== undefined) str += escape_html(ev.content).replace(/\n/g, "<br>");
    el("pvnote").innerHTML = str;
  }
  if (ev.pubkey && !profileRequested) {
    profileRequested = true;
    currentProfileDispose = fetchProfile(currentRelaysRaw, ev.pubkey, PROFILE_EOSE_TIMEOUT, (content) => {
      update_pvprof(
        (content.name as string) || "",
        (content.display_name as string) || "",
        (content.picture as string) || ""
      );
    });
  }
}
function update_pvprof(name: string, dname: string, pic: string) {
  const imgicon = el<HTMLImageElement>("imgicon");
  if (pic !== "") {
    imgicon.setAttribute("src", pic);
    imgicon.style.display = "inline";
  } else {
    imgicon.style.display = "none";
  }
  if (name !== "") el("pvname").innerHTML = "(@" + escape_html(name) + ")";
  if (dname !== "") el("pvdname").innerHTML = escape_html(dname);
}

// ---- URL <-> form ----
function getaddr(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}
function urlsp2form(urlsp: URLSearchParams): boolean {
  let isset = false;
  named<HTMLInputElement>("pvcheck").checked = !urlsp.has("hidepv");
  named<HTMLInputElement>("formcheck").checked = !urlsp.has("hideform");
  if (urlsp.has("eid")) {
    el<HTMLInputElement>("eid").value = urlsp.get("eid")!;
    isset = true;
  } else if (urlsp.has("noteid")) {
    // support old version
    el<HTMLInputElement>("eid").value = urlsp.get("noteid")!;
    isset = true;
  }
  if (urlsp.has("kind")) {
    el<HTMLInputElement>("kind").value = urlsp.get("kind")!;
    isset = true;
  }
  if (urlsp.has("relay")) {
    el<HTMLTextAreaElement>("relayliststr").value = urlsp.get("relay")!.replace(/;/g, "\n");
    isset = true;
  }
  if (urlsp.has("since")) {
    el<HTMLInputElement>("since").value = urlsp.get("since")!;
    isset = true;
  }
  if (urlsp.has("until")) {
    el<HTMLInputElement>("until").value = urlsp.get("until")!;
    isset = true;
  }
  if (urlsp.has("disableid")) el<HTMLInputElement>("eidcheck").checked = false;
  if (urlsp.has("disablekind")) el<HTMLInputElement>("kindcheck").checked = false;
  if (urlsp.has("disablesince")) el<HTMLInputElement>("sincecheck").checked = false;
  if (urlsp.has("disableuntil")) el<HTMLInputElement>("untilcheck").checked = false;
  return isset;
}
function form2url(): string {
  let query = "";
  if (!named<HTMLInputElement>("formcheck").checked) query += "&hideform";
  if (!named<HTMLInputElement>("pvcheck").checked) query += "&hidepv";
  const eid = el<HTMLInputElement>("eid").value;
  const kind = el<HTMLInputElement>("kind").value;
  const since = el<HTMLInputElement>("since").value;
  const until = el<HTMLInputElement>("until").value;
  const relay = el<HTMLTextAreaElement>("relayliststr").value;
  if (eid !== "") query += "&eid=" + eid;
  if (kind !== "") query += "&kind=" + kind;
  if (since !== "") query += "&since=" + since;
  if (until !== "") query += "&until=" + until;
  if (relay !== "") query += "&relay=" + relay.replace(/\n/g, ";");
  if (!el<HTMLInputElement>("eidcheck").checked) query += "&disableid";
  if (!el<HTMLInputElement>("kindcheck").checked) query += "&disablekind";
  if (!el<HTMLInputElement>("sincecheck").checked) query += "&disablesince";
  if (!el<HTMLInputElement>("untilcheck").checked) query += "&disableuntil";
  return location.origin + location.pathname + "?" + query.slice(1);
}
function handle_copy_button() {
  navigator.clipboard.writeText(form2url());
}
function handle_search_button() {
  let str = form2url();
  str = "?" + str.split("?")[1];
  updateState({ settings: str });
  startcheckrelays();

  // Only scroll to result for portrait mode smartphones
  if (window.innerHeight > window.innerWidth) {
    const resultElement = document.getElementById("time");
    if (resultElement) resultElement.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// ---- id resolution ----
interface ResolvedEid {
  ok: boolean;
  filterKey: "" | "ids" | "authors";
  idField: "" | "id" | "pubkey";
  notehex: string;
  // which entity the id box held; "" when empty or invalid
  entity: "" | "note" | "nevent" | "npub" | "nprofile" | "hex";
  // event kind carried by an nevent, if any
  kind?: number;
}
function resolveEid(raw: string): ResolvedEid {
  const bad: ResolvedEid = { ok: false, filterKey: "", idField: "", notehex: "", entity: "" };
  const v = raw.trim();
  if (v === "") return { ok: true, filterKey: "", idField: "", notehex: "", entity: "" };
  const n = v.substr(0, 6) === "nostr:" ? 6 : 0;
  const body = v.substring(n);
  let filterKey: "ids" | "authors";
  let idField: "id" | "pubkey";
  if (body.substr(0, 4) === "note" || body.substr(0, 6) === "nevent") {
    filterKey = "ids";
    idField = "id";
  } else if (body.substr(0, 4) === "npub" || body.substr(0, 8) === "nprofile") {
    filterKey = "authors";
    idField = "pubkey";
  } else if (/^[a-fA-F0-9]+$/.test(v)) {
    return { ok: true, filterKey: "ids", idField: "id", notehex: v, entity: "hex" };
  } else {
    return bad;
  }
  try {
    const dec = decodeNip19(body);
    switch (dec.type) {
      case "note":
      case "npub":
        return { ok: true, filterKey, idField, notehex: dec.data, entity: dec.type };
      case "nevent":
        return { ok: true, filterKey, idField, notehex: dec.data.id, entity: "nevent", kind: dec.data.kind };
      case "nprofile":
        return { ok: true, filterKey, idField, notehex: dec.data.pubkey, entity: "nprofile" };
    }
  } catch (e) {
    return bad;
  }
}

// ---- relay check ----
const relayCells = new Map<string, HTMLElement[]>();
let currentRelaysRaw: string[] = [];
let currentDispose: (() => void) | null = null;
let curFilterKey: "" | "ids" | "authors" = "";
let curIdField: "" | "id" | "pubkey" = "";
let curNotehex = "";

// ---- delete request (NIP-09 kind:5) ----
// The buttons send a deletion request (NIP-09 kind:5) for the event.
let delTargetId = ""; // event id the table is about; "" when requests are not possible
let delTargetKind: number | undefined; // for the optional "k" tag
const relayDelStatus = new Map<string, HTMLElement[]>(); // relayKey -> status spans
const rawOfKey = new Map<string, string>(); // relayKey -> relay URL as entered
const existKeys = new Set<string>(); // relayKeys where the event exists
let allDelButton: HTMLButtonElement | null = null; // null when requests are not possible

function pushTo<T>(map: Map<string, T[]>, key: string, v: T) {
  let arr = map.get(key);
  if (!arr) {
    arr = [];
    map.set(key, arr);
  }
  arr.push(v);
}

// A relay cell: the text, then the status of the last delete request (floated
// right on wide screens, on its own line below the text on narrow ones).
function relayCell(text: string) {
  const td = document.createElement("td");
  td.setAttribute("class", "tdrelay");
  const status = document.createElement("span");
  status.setAttribute("class", "delstatus");
  td.appendChild(document.createTextNode(text));
  td.appendChild(status);
  return { td, status };
}

// A cell holding a "delete request" button for `relays`; it reports to `status`.
// `targets` is evaluated at click time; `toExist` marks the all-relays button.
function deleteRequestCell(
  targets: () => string[],
  enabled: boolean,
  status: HTMLElement,
  toExist: boolean
) {
  const td = document.createElement("td");
  td.setAttribute("class", "tddel");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "delete request";
  btn.disabled = !enabled;
  if (!enabled) {
    btn.title = isJa()
      ? "event id が ✅ で note1 / nevent1 のときだけ削除依頼を送れます"
      : "Available only when the event id is checked and is a note1 / nevent1";
  }
  td.appendChild(btn);
  btn.addEventListener("click", () => requestDelete(targets(), status, toExist));
  return { td, btn };
}

function preparetable(relaylist: string[], deletable: boolean) {
  const result = el<HTMLTableElement>("result");
  while (result.firstChild) result.removeChild(result.firstChild);
  relayCells.clear();
  relayDelStatus.clear();
  rawOfKey.clear();
  existKeys.clear();
  for (const raw of relaylist) {
    const tr = document.createElement("tr");
    result.appendChild(tr);

    const td0 = document.createElement("td");
    td0.textContent = "connecting...";
    td0.setAttribute("class", "tdcon");
    tr.appendChild(td0);

    const rel = relayCell(raw);
    tr.appendChild(rel.td);
    tr.appendChild(deleteRequestCell(() => [raw], deletable, rel.status, false).td);

    const key = relayKey(raw);
    if (!rawOfKey.has(key)) rawOfKey.set(key, raw);
    pushTo(relayCells, key, td0);
    pushTo(relayDelStatus, key, rel.status);
  }

  // last row: send the request at once to the relays where the event exists.
  // It stays disabled until the first "exist" result arrives.
  const tr = document.createElement("tr");
  result.appendChild(tr);
  tr.appendChild(document.createElement("td"));
  const all = relayCell("all relays");
  tr.appendChild(all.td);
  const allDel = deleteRequestCell(
    () => [...existKeys].map((k) => rawOfKey.get(k) ?? k),
    false,
    all.status,
    true
  );
  tr.appendChild(allDel.td);
  allDelButton = deletable ? allDel.btn : null;
  if (allDelButton) {
    allDelButton.title = isJa()
      ? "イベントが存在する (exist) リレーにだけ送ります。まだ exist のリレーがありません"
      : "Sent only to the relays where the event exists; none found yet";
  }
}

// Status texts: accepted in green ("ok"), every other result in red ("ng").
const DELETE_STATUS: Record<DeleteResult, [string, "ok" | "ng"]> = {
  accepted: ["accepted", "ok"],
  rejected: ["rejected", "ng"],
  error: ["error to open", "ng"],
  noresponse: ["no response", "ng"],
};
function showStatus(el: HTMLElement, text: string, tone: "" | "ok" | "ng") {
  el.className = "delstatus" + (tone ? " " + tone : "");
  el.textContent = text;
}

function requestDelete(relays: string[], summary: HTMLElement, toExist: boolean) {
  if (delTargetId === "") return;
  const w = window as unknown as { nostr?: any };
  if (!w.nostr || !w.nostr.signEvent) {
    alert(isJa() ? "NIP-07拡張がありません" : "No NIP-07 extension");
    return;
  }
  const targets: string[] = [];
  const seen = new Set<string>();
  for (const r of relays) {
    const k = relayKey(r);
    if (!seen.has(k)) {
      seen.add(k);
      targets.push(r);
    }
  }
  if (targets.length === 0) return;

  const where = !toExist
    ? targets[0]
    : isJa()
      ? `イベントが存在する (exist) ${targets.length} リレー`
      : `the ${targets.length} relay${targets.length === 1 ? "" : "s"} where the event exists`;
  const msg = isJa()
    ? `このイベントの削除依頼 (kind:5) を ${where} に送ります。よろしいですか？`
    : `Send a deletion request (kind:5) for this event to ${where}?`;
  if (!confirm(msg)) return;

  const single = !toExist;
  const setStatus = (key: string, text: string, tone: "" | "ok" | "ng") => {
    for (const s of relayDelStatus.get(key) || []) showStatus(s, text, tone);
  };
  const results = new Map<string, DeleteResult>(); // relayKey -> result
  let failure = "";
  for (const r of targets) setStatus(relayKey(r), "sending...", "");
  if (!single) showStatus(summary, "sending...", "");

  sendDeleteRequest(targets, delTargetId, delTargetKind, DELETE_OK_TIMEOUT, {
    onResult: (relay, result, notice) => {
      const key = relayKey(relay);
      results.set(key, result);
      const [text, tone] = DELETE_STATUS[result];
      setStatus(key, text + (notice ? ": " + notice : ""), tone);
      print("delete request: " + text + ": " + relay + (notice ? " " + notice : "") + "\n");
    },
    onError: (e) => {
      failure = String(e);
      print("delete request error: " + failure + "\n");
    },
    onComplete: () => {
      if (failure) {
        for (const r of targets) setStatus(relayKey(r), "not sent", "ng");
        if (!single) showStatus(summary, "not sent: " + failure, "ng");
        return;
      }
      if (single) return;
      // e.g. "accepted 3, rejected 1, error to open 1": accepted always, others if any
      summary.className = "delstatus";
      summary.textContent = "";
      const order: DeleteResult[] = ["accepted", "rejected", "error", "noresponse"];
      for (const result of order) {
        const n = [...results.values()].filter((x) => x === result).length;
        if (result !== "accepted" && n === 0) continue;
        if (summary.firstChild) summary.appendChild(document.createTextNode(", "));
        const [text, tone] = DELETE_STATUS[result];
        const part = document.createElement("span");
        part.className = tone;
        part.textContent = text + " " + n;
        summary.appendChild(part);
      }
    },
  });
}
function setRelayResult(relay: string, result: RelayResult) {
  const cells = relayCells.get(relayKey(relay));
  if (!cells) return;
  if (result === "exist") {
    existKeys.add(relayKey(relay));
    if (allDelButton) {
      allDelButton.disabled = false;
      allDelButton.title = "";
    }
  }
  let text = "";
  let cls = "";
  switch (result) {
    case "exist":
      text = "exist";
      cls = "tdexist";
      break;
    case "notexist":
      text = "not exist";
      cls = "tdnotexist";
      break;
    case "error":
      text = "error to open";
      cls = "tderror";
      break;
    case "noreply":
      text = "no reply";
      cls = "tderror";
      break;
  }
  for (const c of cells) {
    c.textContent = text;
    c.setAttribute("class", cls);
  }
}
function matchesEvent(ev: NostrEvent): boolean {
  const eidcheck = el<HTMLInputElement>("eidcheck");
  const kindcheck = el<HTMLInputElement>("kindcheck");
  const kindEl = el<HTMLInputElement>("kind");
  const idOk =
    !eidcheck.checked ||
    curFilterKey === "" ||
    curNotehex === "" ||
    (curIdField === "id" ? ev.id === curNotehex : ev.pubkey === curNotehex);
  const kstr = kindEl.value.trim();
  const kindOk =
    !kindcheck.checked ||
    kstr === "" ||
    (ev.kind !== undefined && parseKinds(kindEl.value).includes(ev.kind));
  return idOk && kindOk;
}

// ---- countdown ----
let countdownTimer: number | undefined;
function startCountdown() {
  stopCountdown();
  const start = Date.now();
  countdownTimer = window.setInterval(() => {
    const left = Math.floor((CHECK_EOSE_TIMEOUT - (Date.now() - start)) / 1000);
    el("time").textContent = " left " + Math.max(0, left) + " seconds until timeout";
  }, 200);
}
function stopCountdown() {
  if (countdownTimer !== undefined) {
    clearInterval(countdownTimer);
    countdownTimer = undefined;
  }
}

function startcheckrelays() {
  // abort any previous run
  if (currentDispose) {
    currentDispose();
    currentDispose = null;
  }
  if (currentProfileDispose) {
    currentProfileDispose();
    currentProfileDispose = null;
  }

  const relaylist = el<HTMLTextAreaElement>("relayliststr")
    .value.replace(/\n\n*/g, "\n")
    .replace(/\n$/, "")
    .split("\n")
    .filter((x) => x.trim() !== "");
  currentRelaysRaw = relaylist;

  // reset preview
  update_pvprof("", "", "");
  pvnotetime = 0;
  profileRequested = false;

  // resolve id
  const r = resolveEid(el<HTMLInputElement>("eid").value);
  curFilterKey = r.filterKey;
  curIdField = r.idField;
  curNotehex = r.notehex;

  // delete requests: only for a checked note1 / nevent1 id
  const deletable =
    r.ok &&
    el<HTMLInputElement>("eidcheck").checked &&
    (r.entity === "note" || r.entity === "nevent") &&
    r.notehex !== "";
  delTargetId = deletable ? r.notehex : "";
  delTargetKind = deletable ? r.kind : undefined;

  preparetable(relaylist, deletable);

  if (!r.ok) {
    el("time").textContent =
      "Invalid id. id should start from npub or nprofile or note or nevent.";
    for (const cells of relayCells.values())
      for (const c of cells) {
        c.textContent = "id is invalid";
        c.setAttribute("class", "tderror");
      }
    return;
  }

  // build REQ filter
  const eventFilter: LazyFilter = {};
  if (el<HTMLInputElement>("eidcheck").checked && curFilterKey !== "" && curNotehex !== "") {
    if (curFilterKey === "ids") eventFilter.ids = [curNotehex];
    else eventFilter.authors = [curNotehex];
  }
  if (el<HTMLInputElement>("kindcheck").checked) {
    const kinds = parseKinds(el<HTMLInputElement>("kind").value);
    if (kinds.length > 0) eventFilter.kinds = kinds;
  }
  if (el<HTMLInputElement>("sincecheck").checked) {
    const s = parseTimestamp(el<HTMLInputElement>("since").value);
    if (s !== null) eventFilter.since = s;
  }
  if (el<HTMLInputElement>("untilcheck").checked) {
    const u = parseTimestamp(el<HTMLInputElement>("until").value);
    if (u !== null) eventFilter.until = u;
  }

  startCountdown();

  currentDispose = checkEventOnRelays(relaylist, eventFilter, matchesEvent, CHECK_EOSE_TIMEOUT, {
    onEvent: (_relay, ev) => {
      // the event's own kind is authoritative for the delete request "k" tag
      if (delTargetId !== "" && ev.id === delTargetId) delTargetKind = ev.kind;
      pvevent(ev);
    },
    onResult: (relay, result) => setRelayResult(relay, result),
    onComplete: () => {
      stopCountdown();
      el("time").textContent = "";
    },
    log: (m) => print(m),
  });
}

// ---- relay discovery (Get relay buttons) ----
async function put_my_relays(kind: number) {
  const ta = el<HTMLTextAreaElement>("relayliststr");
  ta.value = "wait for your relays...";
  try {
    const w = window as unknown as { nostr?: any; alby?: any };
    let pubkey: string;
    if (w.alby) {
      pubkey = await w.alby.nostr.getPublicKey();
    } else if (w.nostr) {
      pubkey = await w.nostr.getPublicKey();
    } else {
      throw "Please set NIP-07 browser extension or Alby extension.";
    }
    const list = await fetchRelayList(
      defaultset.bootstraprelaylist,
      pubkey,
      kind,
      RELAYLIST_EOSE_TIMEOUT,
      defaultset.relaylist
    );
    ta.value = list.map((r) => r + "\n").join("");
  } catch (e) {
    el("time").textContent = String(e);
  }
}

// ---- init ----
function init() {
  el("version").textContent = version;
  initHtml(navigator.language);

  // default settings
  const ta = el<HTMLTextAreaElement>("relayliststr");
  ta.value = "";
  for (const r of defaultset.relaylist) ta.value += r + "\n";
  el<HTMLInputElement>("eid").value = defaultset.eid;
  el<HTMLInputElement>("kind").value = "1";

  // settings from localStorage
  const lsstate = loadState();
  if (lsstate.settings !== undefined && lsstate.settings !== null) {
    urlsp2form(new URLSearchParams(lsstate.settings));
  }

  // settings from HTTP query
  const isbyquery = urlsp2form(getaddr());
  if (isbyquery) startcheckrelays();

  showform();
  showpv();

  // dark mode (default: dark)
  const dm = lsstate.darkmode;
  applyDark(dm === undefined || dm === null ? true : dm === true || dm === "true");

  // NIP-07 account display
  initAccount();

  // close the menu when clicking outside of it
  document.addEventListener("click", (e) => {
    const menu = el("menu");
    const panel = el("menupanel");
    if (menu && panel && !menu.contains(e.target as Node)) panel.style.display = "none";
  });
}

// expose for the inline onclick handlers kept in index.html
declare global {
  interface Window {
    toggleMenu: () => void;
    login_nip07: () => void;
    toggleDark: () => void;
    showform: () => void;
    showpv: () => void;
    showdebug: () => void;
    resetLocalStorage: () => void;
    put_my_relays: (kind: number) => void;
    handle_search_button: () => void;
    handle_copy_button: () => void;
  }
}
window.toggleMenu = toggleMenu;
window.login_nip07 = login_nip07;
window.toggleDark = toggleDark;
window.showform = showform;
window.showpv = showpv;
window.showdebug = showdebug;
window.resetLocalStorage = resetLocalStorage;
window.put_my_relays = put_my_relays;
window.handle_search_button = handle_search_button;
window.handle_copy_button = handle_copy_button;

if (document.readyState === "complete") init();
else window.addEventListener("load", init);
