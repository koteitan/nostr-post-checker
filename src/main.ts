import { parseTimestamp, parseKinds } from "./timestamp";
import { decodeNip19 } from "./nip19";
import {
  checkEventOnRelays,
  fetchProfile,
  fetchRelayList,
  relayKey,
  type NostrEvent,
  type RelayResult,
} from "./nostr";
import type { LazyFilter } from "rx-nostr";

const version = "1.52";

// ---- timeouts (ms) ----
const CHECK_EOSE_TIMEOUT = 60000; // matches the original 60s overall timeout
const PROFILE_EOSE_TIMEOUT = 5000;
const RELAYLIST_EOSE_TIMEOUT = 5000;

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
}
function resolveEid(raw: string): ResolvedEid {
  const v = raw.trim();
  if (v === "") return { ok: true, filterKey: "", idField: "", notehex: "" };
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
    return { ok: true, filterKey: "ids", idField: "id", notehex: v };
  } else {
    return { ok: false, filterKey: "", idField: "", notehex: "" };
  }
  try {
    const dec = decodeNip19(body);
    let hex = "";
    if (dec.type === "note" || dec.type === "npub") hex = dec.data;
    else if (dec.type === "nevent") hex = dec.data.id;
    else if (dec.type === "nprofile") hex = dec.data.pubkey;
    return { ok: true, filterKey, idField, notehex: hex };
  } catch (e) {
    return { ok: false, filterKey: "", idField: "", notehex: "" };
  }
}

// ---- relay check ----
const relayCells = new Map<string, HTMLElement[]>();
let currentRelaysRaw: string[] = [];
let currentDispose: (() => void) | null = null;
let curFilterKey: "" | "ids" | "authors" = "";
let curIdField: "" | "id" | "pubkey" = "";
let curNotehex = "";

function preparetable(relaylist: string[]) {
  const result = el<HTMLTableElement>("result");
  while (result.firstChild) result.removeChild(result.firstChild);
  relayCells.clear();
  for (const raw of relaylist) {
    const tr = document.createElement("tr");
    result.appendChild(tr);

    const td0 = document.createElement("td");
    td0.textContent = "connecting...";
    td0.setAttribute("class", "tdcon");
    tr.appendChild(td0);

    const td1 = document.createElement("td");
    td1.textContent = raw;
    td1.setAttribute("class", "tdrelay");
    tr.appendChild(td1);

    const key = relayKey(raw);
    let arr = relayCells.get(key);
    if (!arr) {
      arr = [];
      relayCells.set(key, arr);
    }
    arr.push(td0);
  }
}
function setRelayResult(relay: string, result: RelayResult) {
  const cells = relayCells.get(relayKey(relay));
  if (!cells) return;
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

  preparetable(relaylist);

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
    onEvent: (_relay, ev) => pvevent(ev),
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
