// NIP-19 bech32 entities.
//
// This is an original implementation of the bech32 algorithm written against
// the BIP-173 specification (the algorithm itself is a public standard). It is
// deliberately NOT derived from any third-party bech32 library, so no external
// source license / attribution applies. Decode is symmetric with encode.

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
// BIP-173 checksum generator constants.
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const CHARSET_REV: Record<string, number> = {};
for (let i = 0; i < CHARSET.length; i++) CHARSET_REV[CHARSET[i]] = i;

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >>> i) & 1) chk ^= GENERATOR[i];
    }
  }
  return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const high: number[] = [];
  const low: number[] = [];
  for (let i = 0; i < hrp.length; i++) {
    const c = hrp.charCodeAt(i);
    high.push(c >>> 5);
    low.push(c & 31);
  }
  return [...high, 0, ...low];
}

function convertBits(data: number[], from: number, to: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || value >> from !== 0) throw new Error("convertBits: invalid value");
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv)) {
    throw new Error("convertBits: invalid padding");
  }
  return out;
}

export function toWords(bytes: number[]): number[] {
  return convertBits(bytes, 8, 5, true);
}

export function fromWords(words: number[]): number[] {
  return convertBits(words, 5, 8, false);
}

export function encodeBech32(prefix: string, words: number[], limit = 90): string {
  const lower = prefix.toLowerCase();
  const mod = polymod(hrpExpand(lower).concat(words, [0, 0, 0, 0, 0, 0])) ^ 1;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i++) checksum.push((mod >>> (5 * (5 - i))) & 31);
  const out = lower + "1" + words.concat(checksum).map((w) => CHARSET[w]).join("");
  if (out.length > limit) throw new Error("bech32: exceeds length limit");
  return out;
}

export function decodeBech32(str: string, limit = 90): { prefix: string; words: number[] } {
  if (str.length > limit) throw new Error("bech32: exceeds length limit");
  if (str !== str.toLowerCase() && str !== str.toUpperCase()) {
    throw new Error("bech32: mixed-case string");
  }
  const s = str.toLowerCase();
  const sep = s.lastIndexOf("1");
  if (sep < 1 || sep + 7 > s.length) throw new Error("bech32: invalid separator position");
  const prefix = s.slice(0, sep);
  const chars = s.slice(sep + 1);
  const words: number[] = [];
  for (const ch of chars) {
    const v = CHARSET_REV[ch];
    if (v === undefined) throw new Error("bech32: invalid character '" + ch + "'");
    words.push(v);
  }
  if (polymod(hrpExpand(prefix).concat(words)) !== 1) throw new Error("bech32: invalid checksum");
  return { prefix, words: words.slice(0, words.length - 6) };
}

// ---- NIP-19 ----

function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToUtf8(bytes: number[]): string {
  return new TextDecoder().decode(new Uint8Array(bytes));
}

// Parse a NIP-19 TLV payload into { type: values[] }.
function parseTlv(bytes: number[]): Record<number, number[][]> {
  const result: Record<number, number[][]> = {};
  let pos = 0;
  while (pos + 1 < bytes.length) {
    const type = bytes[pos++];
    const len = bytes[pos++];
    if (pos + len > bytes.length) break;
    const value = bytes.slice(pos, pos + len);
    pos += len;
    (result[type] ||= []).push(value);
  }
  return result;
}

export type Nip19Decoded =
  | { type: "note"; data: string }
  | { type: "npub"; data: string }
  | { type: "nevent"; data: { id: string; relays: string[]; author?: string; kind?: number } }
  | { type: "nprofile"; data: { pubkey: string; relays: string[] } };

// Decode a NIP-19 string (note / npub / nevent / nprofile). Throws on invalid.
export function decodeNip19(input: string): Nip19Decoded {
  const { prefix, words } = decodeBech32(input, 5000);
  const bytes = fromWords(words);

  switch (prefix) {
    case "note":
      return { type: "note", data: bytesToHex(bytes) };
    case "npub":
      return { type: "npub", data: bytesToHex(bytes) };
    case "nevent": {
      const tlv = parseTlv(bytes);
      if (!tlv[0] || tlv[0].length === 0) throw new Error("nevent is missing id");
      const id = bytesToHex(tlv[0][0]);
      const relays = (tlv[1] || []).map(bytesToUtf8);
      const author = tlv[2] && tlv[2][0] ? bytesToHex(tlv[2][0]) : undefined;
      let kind: number | undefined;
      if (tlv[3] && tlv[3][0] && tlv[3][0].length === 4) {
        const k = tlv[3][0];
        kind = ((k[0] << 24) | (k[1] << 16) | (k[2] << 8) | k[3]) >>> 0;
      }
      return { type: "nevent", data: { id, relays, author, kind } };
    }
    case "nprofile": {
      const tlv = parseTlv(bytes);
      if (!tlv[0] || tlv[0].length === 0) throw new Error("nprofile is missing pubkey");
      const pubkey = bytesToHex(tlv[0][0]);
      const relays = (tlv[1] || []).map(bytesToUtf8);
      return { type: "nprofile", data: { pubkey, relays } };
    }
    default:
      throw new Error("Unsupported NIP-19 prefix: " + prefix);
  }
}
