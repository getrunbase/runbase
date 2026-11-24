// Anti-SSRF IP address filter, shared by the http block
// (Node) and the Deno sandbox preamble (same JS source, injected as
// is into guard.js: a single implementation).
// Always refused: non-routable (0.0.0.0/8, ::), link-local including
// cloud metadata (169.254.0.0/16, fe80::/10), multicast/reserved.
// Refused unless private network is allowed: loopback (127/8, ::1), RFC 1918,
// CGNAT (100.64/10), ULA (fc00::/7, hence fd00::/8). Also always refused:
// 192.0.0/24, 198.18/15, site-local (fec0::/10). IPv4 mapped in IPv6
// (::ffff:a.b.c.d, ::ffff:7f00:1), NAT64 (64:ff9b::/96) and 6to4
// (2002::/16) are judged like their embedded IPv4.
import { env } from "../env";

export const IP_FILTER_JS = `function blockedAddress(ip, allowPrivate) {
  let a = String(ip).toLowerCase().replace(/^\\[|\\]$/g, "").replace(/%.*$/, "");
  const v4 = (s) => {
    const p = s.split(".");
    if (p.length !== 4 || p.some((x) => !/^\\d{1,3}$/.test(x) || +x > 255)) return null;
    return p.map(Number);
  };
  const judge4 = (b) => {
    const [x, y] = b;
    if (x === 0 || x >= 224 || (x === 169 && y === 254)) return true;
    // IETF protocol assignments (192.0.0/24, incl. 192.0.0.192 metadata) and
    // benchmarking (198.18/15): never public destinations.
    if ((x === 192 && y === 0 && b[2] === 0) || (x === 198 && (y === 18 || y === 19))) return true;
    if (allowPrivate) return false;
    return x === 127 || x === 10 || (x === 172 && y >= 16 && y <= 31) ||
      (x === 192 && y === 168) || (x === 100 && y >= 64 && y <= 127);
  };
  const b4 = v4(a);
  if (b4) return judge4(b4);
  if (!a.includes(":")) return true;
  // IPv6: expanded into 8 groups of 16 bits (optional IPv4 suffix included).
  const tail = a.match(/:(\\d+\\.\\d+\\.\\d+\\.\\d+)$/);
  if (tail) {
    const t = v4(tail[1]);
    if (!t) return true;
    a = a.slice(0, -tail[1].length) + ((t[0] << 8) | t[1]).toString(16) + ":" + ((t[2] << 8) | t[3]).toString(16);
  }
  const halves = a.split("::");
  if (halves.length > 2) return true;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  const g = [...head, ...Array(Math.max(fill, 0)).fill("0"), ...rest];
  if (g.length !== 8 || g.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return true;
  const n = g.map((x) => parseInt(x, 16));
  const tail4 = (h, l) => judge4([h >> 8, h & 255, l >> 8, l & 255]);
  if (n.slice(0, 5).every((x) => x === 0) && n[5] === 0xffff)
    return tail4(n[6], n[7]);
  // NAT64 (64:ff9b::/96) and 6to4 (2002::/16) embed an IPv4: judged like it.
  if (n[0] === 0x64 && n[1] === 0xff9b && n.slice(2, 6).every((x) => x === 0))
    return tail4(n[6], n[7]);
  if (n[0] === 0x2002) return tail4(n[1], n[2]);
  if (n.slice(0, 7).every((x) => x === 0)) return n[7] === 0 || !allowPrivate;
  // Link-local (fe80::/10), deprecated site-local (fec0::/10), multicast.
  if ((n[0] & 0xff80) === 0xfe80 || n[0] >= 0xff00) return true;
  return !allowPrivate && (n[0] & 0xfe00) === 0xfc00;
}`;

// Evaluated once: the same source as in the sandbox.
export const blockedAddress = new Function(`return (${IP_FILTER_JS})`)() as (
  ip: string,
  allowPrivate?: boolean,
) => boolean;

// Private network allowed (dev, tests, self-hosting that calls
// internal services): FUNCTIONS_ALLOW_PRIVATE_NETWORK=1. Link-local
// (cloud metadata) stays refused.
export const privateNetworkAllowed = () =>
  env().FUNCTIONS_ALLOW_PRIVATE_NETWORK;
