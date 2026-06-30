import { createHash, createHmac } from "node:crypto";
import { assertSafeKey, type PutOptions, type StorageDriver } from "./types.js";

export interface S3Config {
  /** Base endpoint, e.g. https://<account>.r2.cloudflarestorage.com */
  endpoint: string;
  region: string; // "auto" for R2
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** RFC 3986 encoding for a single path segment (does NOT encode `/`). */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Minimal S3-compatible storage driver, signed with AWS Signature V4 using
 * only Node's crypto. Uses path-style addressing (`<endpoint>/<bucket>/<key>`)
 * which works with Cloudflare R2, AWS S3, and MinIO alike.
 */
export class S3StorageDriver implements StorageDriver {
  readonly name = "s3";
  private readonly cfg: S3Config;
  private readonly host: string;
  private readonly origin: string;

  constructor(cfg: S3Config) {
    this.cfg = cfg;
    const url = new URL(cfg.endpoint);
    this.host = url.host;
    this.origin = `${url.protocol}//${url.host}`;
  }

  private encodedPath(key: string): string {
    const keyPath = key.split("/").map(encodeSegment).join("/");
    return `/${encodeSegment(this.cfg.bucket)}/${keyPath}`;
  }

  private sign(
    method: string,
    canonicalUri: string,
    payloadHash: string,
    extraHeaders: Record<string, string> = {},
  ): Record<string, string> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
    const dateStamp = amzDate.slice(0, 8); // YYYYMMDD

    const headers: Record<string, string> = {
      host: this.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...Object.fromEntries(
        Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), v]),
      ),
    };

    const sortedHeaderKeys = Object.keys(headers).sort();
    const canonicalHeaders =
      sortedHeaderKeys.map((k) => `${k}:${headers[k]!.trim()}\n`).join("");
    const signedHeaders = sortedHeaderKeys.join(";");

    const canonicalRequest = [
      method,
      canonicalUri,
      "", // canonical query string (none)
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const scope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      sha256hex(canonicalRequest),
    ].join("\n");

    const kDate = hmac(`AWS4${this.cfg.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.cfg.region);
    const kService = hmac(kRegion, "s3");
    const kSigning = hmac(kService, "aws4_request");
    const signature = createHmac("sha256", kSigning)
      .update(stringToSign, "utf8")
      .digest("hex");

    const authorization =
      `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return { ...headers, Authorization: authorization };
  }

  async put(key: string, bytes: Buffer, opts: PutOptions): Promise<void> {
    assertSafeKey(key);
    const canonicalUri = this.encodedPath(key);
    const payloadHash = sha256hex(bytes);
    const headers = this.sign("PUT", canonicalUri, payloadHash, {
      "content-type": opts.contentType,
    });

    const res = await fetch(`${this.origin}${canonicalUri}`, {
      method: "PUT",
      headers,
      // Buffer → Uint8Array: the fetch BodyInit type doesn't include Node's
      // Buffer, though the underlying view is identical.
      body: new Uint8Array(bytes),
    });
    if (!res.ok) {
      throw new Error(`S3 put failed (${res.status}): ${await res.text().catch(() => "")}`);
    }
  }

  async get(key: string): Promise<Buffer | null> {
    assertSafeKey(key);
    const canonicalUri = this.encodedPath(key);
    const headers = this.sign("GET", canonicalUri, EMPTY_SHA256);

    const res = await fetch(`${this.origin}${canonicalUri}`, { method: "GET", headers });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`S3 get failed (${res.status}): ${await res.text().catch(() => "")}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    const canonicalUri = this.encodedPath(key);
    const headers = this.sign("DELETE", canonicalUri, EMPTY_SHA256);

    const res = await fetch(`${this.origin}${canonicalUri}`, { method: "DELETE", headers });
    // S3 returns 204 on delete; treat a missing object (404) as success.
    if (!res.ok && res.status !== 404) {
      throw new Error(`S3 delete failed (${res.status}): ${await res.text().catch(() => "")}`);
    }
  }
}
