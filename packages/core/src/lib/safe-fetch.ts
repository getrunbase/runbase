// Anti-SSRF fetch for external blocks: the IP is checked at
// connection time (socket lookup), not before: no DNS rebinding
// window between the check and the connection. No redirect
// (blocks use redirect: "error"; a 3xx is returned as is).
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { appError } from "../errors/app-error";
import { env } from "../env";
import { blockedAddress, privateNetworkAllowed } from "./ip-filter";

const blocked = (host: string) =>
  appError("http.blockedAddress", "Address not allowed: {host}", { host });

export function assertPublicAddress(host: string, ip: string) {
  if (blockedAddress(ip, privateNetworkAllowed())) throw blocked(host);
}

// Socket lookup: all resolved addresses must be public.
const guardedLookup: LookupFunction = (host, opts, cb) =>
  dnsLookup(host, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err, "", 0);
    const list = addrs as LookupAddress[];
    const bad = list.find((a) =>
      blockedAddress(a.address, privateNetworkAllowed()),
    );
    if (bad) return cb(blocked(host), "", 0);
    if (opts.all)
      return (cb as never as (e: null, a: LookupAddress[]) => void)(null, list);
    cb(null, list[0]!.address, list[0]!.family);
  });

export async function safeFetch(
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<Response> {
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:")
    throw appError("http.unsupportedProtocol", "Unsupported protocol: {protocol}", {
      protocol: u.protocol,
    });
  const host = u.hostname.replace(/^\[|\]$/g, "");
  // Literal IP: lookup never called, direct check.
  if (isIP(host)) assertPublicAddress(host, host);
  const req = u.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const r = req(
      u,
      {
        method: init.method,
        headers: init.headers,
        signal: init.signal,
        lookup: guardedLookup,
      },
      (res) => {
        // Response size cap (HTTP_BLOCK_MAX_BYTES): a huge body would
        // exhaust the worker memory.
        const max = env().HTTP_BLOCK_MAX_BYTES;
        const tooLarge = () =>
          appError(
            "http.responseTooLarge",
            "Response too large (over {max} bytes)",
            { max },
          );
        if (Number(res.headers["content-length"]) > max) {
          res.destroy();
          return reject(tooLarge());
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > max) {
            res.destroy();
            return reject(tooLarge());
          }
          chunks.push(c);
        });
        res.on("error", reject);
        res.on("end", () => {
          const headers = new Headers();
          for (const [k, v] of Object.entries(res.headers))
            for (const x of [v ?? []].flat()) headers.append(k, x);
          const status = res.statusCode ?? 500;
          const empty = status === 204 || status === 304;
          resolve(
            new Response(empty ? null : Buffer.concat(chunks), {
              status,
              headers,
            }),
          );
        });
      },
    );
    r.on("error", reject);
    r.end(init.body);
  });
}
