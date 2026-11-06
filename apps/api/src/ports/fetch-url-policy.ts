// Which addresses and links the media importer may fetch (Story 3.7). Pure, and next to the ExternalFetcher port so both
// sides share it (modules may not import adapters): the media service refuses links whose host is a blocked IP literal
// (422), and the worker's SSRF-safe fetcher checks every resolved address at connect time.
import { BlockList, isIP } from 'node:net';
import { MEDIA_IMPORT_URL_MAX } from '@slips/contracts';

/** IPv4 ranges that are never fetched: this network, private, CGNAT, loopback, link-local (metadata), reserved, documentation, multicast. */
const IPV4_BLOCKED: ReadonlyArray<[string, number]> = [
  ['0.0.0.0', 8], // "this network", unspecified
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, incl. the 169.254.169.254 cloud metadata endpoint
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation (TEST-NET-1)
  ['192.31.196.0', 24], // AS112
  ['192.52.193.0', 24], // AMT
  ['192.88.99.0', 24], // 6to4 relay anycast (deprecated)
  ['192.168.0.0', 16], // private
  ['192.175.48.0', 24], // AS112 direct delegation
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation (TEST-NET-2)
  ['203.0.113.0', 24], // documentation (TEST-NET-3)
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, incl. broadcast 255.255.255.255
];

/**
 * IPv6 ranges inside global unicast (2000::/3) that are still never fetched. Everything outside 2000::/3 is blocked as well
 * (unspecified, loopback, IPv4-compatible, NAT64 64:ff9b::/96 and 64:ff9b:1::/48, discard, unique-local fc00::/7,
 * link-local fe80::/10, site-local, multicast ff00::/8), except IPv4-mapped addresses, which are judged by their IPv4 address.
 */
const IPV6_BLOCKED_IN_GLOBAL: ReadonlyArray<[string, number]> = [
  ['2001::', 23], // IETF protocol assignments, incl. Teredo 2001::/32 and benchmarking 2001:2::/48
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4 (embeds an IPv4 address)
  ['3fff::', 20], // documentation
];

const ipv4Blocked = new BlockList();
for (const [net, prefix] of IPV4_BLOCKED) ipv4Blocked.addSubnet(net, prefix, 'ipv4');
const ipv6Blocked = new BlockList();
for (const [net, prefix] of IPV6_BLOCKED_IN_GLOBAL) ipv6Blocked.addSubnet(net, prefix, 'ipv6');
const ipv6Global = new BlockList();
ipv6Global.addSubnet('2000::', 3, 'ipv6');
const ipv4Mapped = new BlockList();
ipv4Mapped.addSubnet('::ffff:0:0', 96, 'ipv6');

/** True when `address` must never be fetched. Anything that is not an IP address (or carries an IPv6 zone) counts as blocked. */
export function isBlockedAddress(address: string): boolean {
  const ip = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
  const family = isIP(ip);
  if (family === 4) return ipv4Blocked.check(ip, 'ipv4');
  if (family !== 6 || ip.includes('%')) return true;
  // IPv4-mapped (::ffff:a.b.c.d): Node's BlockList matches it against the IPv4 rules.
  if (ipv4Mapped.check(ip, 'ipv6')) return ipv4Blocked.check(ip, 'ipv6');
  return !ipv6Global.check(ip, 'ipv6') || ipv6Blocked.check(ip, 'ipv6');
}

/** Why a link may not be fetched, checked before any connection. */
export type FetchUrlProblem = 'invalid' | 'too_long' | 'scheme' | 'port' | 'credentials' | 'blocked_address';

/**
 * The link as a URL when it may be fetched: `http`/`https`, port 80 or 443 (or the default), no user info, at most
 * `MEDIA_IMPORT_URL_MAX` characters, and a host that is not a blocked IP literal (the WHATWG parser already normalizes forms
 * like `0x7f.1` or `2130706433` to `127.0.0.1`). Hosts given as names are checked when they resolve (the fetcher's `lookup`).
 */
/** What `checkFetchUrl` enforces; the defaults are the production rules (tests of the fetcher widen them for a local server). */
export interface FetchUrlPolicy {
  /** `URL.port` values accepted ('' is the scheme default). */
  ports: readonly string[];
  isBlocked: (address: string) => boolean;
}

export const DEFAULT_FETCH_URL_POLICY: FetchUrlPolicy = { ports: ['', '80', '443'], isBlocked: isBlockedAddress };

export function checkFetchUrl(raw: string, policy: FetchUrlPolicy = DEFAULT_FETCH_URL_POLICY): { ok: true; url: URL } | { ok: false; problem: FetchUrlProblem } {
  if (raw.length > MEDIA_IMPORT_URL_MAX) return { ok: false, problem: 'too_long' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, problem: 'invalid' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, problem: 'scheme' };
  if (!policy.ports.includes(url.port)) return { ok: false, problem: 'port' };
  if (url.username !== '' || url.password !== '') return { ok: false, problem: 'credentials' };
  if (url.hostname === '') return { ok: false, problem: 'invalid' };
  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  if (isIP(host) !== 0 && policy.isBlocked(host)) return { ok: false, problem: 'blocked_address' };
  if (url.href.length > MEDIA_IMPORT_URL_MAX) return { ok: false, problem: 'too_long' };
  return { ok: true, url };
}
