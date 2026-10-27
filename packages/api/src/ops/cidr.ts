/**
 * CIDR allowlist matching for OPS_IP_ALLOWLIST (IPv4 and IPv6). A bare
 * address is a /32 (or /128). IPv4-mapped IPv6 addresses (::ffff:a.b.c.d)
 * are matched as IPv4.
 */
import { isIP } from "node:net";

export interface Cidr {
  version: 4 | 6;
  network: bigint;
  prefix: number;
}

function ipv4ToBigInt(ip: string): bigint {
  return ip.split(".").reduce((acc, part) => (acc << 8n) | BigInt(Number.parseInt(part, 10)), 0n);
}

function ipv6ToBigInt(ip: string): bigint {
  // Expand an embedded IPv4 tail (e.g. ::ffff:192.0.2.1) into two hextets.
  let addr = ip;
  const v4 = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = ipv4ToBigInt(v4[1]);
    addr = addr.slice(0, -v4[1].length) + `${(n >> 16n).toString(16)}:${(n & 0xffffn).toString(16)}`;
  }
  const [head, tail] = addr.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const missing = 8 - headParts.length - tailParts.length;
  const parts = tail === undefined ? headParts : [...headParts, ...Array(missing).fill("0"), ...tailParts];
  return parts.reduce((acc, h) => (acc << 16n) | BigInt(Number.parseInt(h || "0", 16)), 0n);
}

/** Normalise an address to {version, value}; IPv4-mapped IPv6 becomes IPv4. */
function parseAddress(raw: string): { version: 4 | 6; value: bigint } | null {
  const ip = raw.trim().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const version = isIP(ip);
  if (version === 4) return { version: 4, value: ipv4ToBigInt(ip) };
  if (version === 6) {
    const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return { version: 4, value: ipv4ToBigInt(mapped[1]) };
    return { version: 6, value: ipv6ToBigInt(ip) };
  }
  return null;
}

function mask(version: 4 | 6, prefix: number): bigint {
  const bits = version === 4 ? 32 : 128;
  return prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
}

export function parseCidr(entry: string): Cidr {
  const [addrPart, prefixPart] = entry.trim().split("/");
  const addr = parseAddress(addrPart ?? "");
  if (!addr) throw new Error(`OPS_IP_ALLOWLIST: invalid address "${entry}"`);
  const max = addr.version === 4 ? 32 : 128;
  const prefix = prefixPart === undefined ? max : Number(prefixPart);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) {
    throw new Error(`OPS_IP_ALLOWLIST: invalid prefix in "${entry}"`);
  }
  return { version: addr.version, prefix, network: addr.value & mask(addr.version, prefix) };
}

export function parseCidrList(list: string): Cidr[] {
  return list.split(",").map((s) => s.trim()).filter(Boolean).map(parseCidr);
}

export function ipAllowed(ip: string | null, allowlist: Cidr[]): boolean {
  if (!ip) return false;
  const addr = parseAddress(ip);
  if (!addr) return false;
  return allowlist.some((c) => c.version === addr.version && (addr.value & mask(c.version, c.prefix)) === c.network);
}
