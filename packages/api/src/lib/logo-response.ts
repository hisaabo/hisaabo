/**
 * logo-response.ts — business logo HTTP response with ETag-before-bytes.
 *
 * The metadata query never reads the bytea column (only `IS NOT NULL`), so a
 * conditional-GET hit (If-None-Match === ETag) answers 304 without loading the
 * logo bytes. Bytes are fetched only when the client's validator is stale.
 * Headers are identical to the previous inline implementation.
 */
import { sql, type SQL } from "drizzle-orm";
import { businesses } from "@hisaabo/db";
import type { getTenantDb } from "@hisaabo/db";

type Db = Awaited<ReturnType<typeof getTenantDb>>;

// 1x1 transparent PNG: served when a business has no logo so <img> tags don't
// show broken-image icons.
export const EMPTY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

// `nosniff` + strict CSP so a browser never sniffs the bytes as HTML/JS even if
// something slipped past the magic-byte check at upload time.
export const LOGO_SAFE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'none'",
  "Cross-Origin-Resource-Policy": "same-site",
};

function emptyPng(scope: "private" | "public"): Response {
  return new Response(new Uint8Array(EMPTY_PNG), {
    status: 200,
    headers: {
      ...LOGO_SAFE_HEADERS,
      "Content-Type": "image/png",
      "Cache-Control": `${scope}, max-age=60`,
    },
  });
}

export async function serveBusinessLogo(
  db: Db,
  where: SQL | undefined,
  ifNoneMatch: string | undefined,
  scope: "private" | "public",
): Promise<Response> {
  const [meta] = await db.select({
    hasLogo: sql<boolean>`${businesses.logoData} IS NOT NULL`,
    logoMimeType: businesses.logoMimeType,
    logoUpdatedAt: businesses.logoUpdatedAt,
  }).from(businesses).where(where).limit(1);

  if (!meta || !meta.hasLogo || !meta.logoMimeType) return emptyPng(scope);

  const etag = `"${meta.logoUpdatedAt?.getTime() ?? 0}"`;
  if (ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, ...LOGO_SAFE_HEADERS } });
  }

  const [bytes] = await db.select({ logoData: businesses.logoData })
    .from(businesses).where(where).limit(1);
  if (!bytes?.logoData) return emptyPng(scope);

  return new Response(new Uint8Array(bytes.logoData), {
    status: 200,
    headers: {
      ...LOGO_SAFE_HEADERS,
      "Content-Type": meta.logoMimeType,
      "Cache-Control": `${scope}, max-age=${scope === "private" ? 300 : 3600}`,
      ETag: etag,
    },
  });
}
