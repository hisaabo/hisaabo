/**
 * Tests for pure helper functions in lib/email.ts.
 *
 * WHY THIS FILE EXISTS:
 * email.ts embeds user-supplied strings directly into HTML email bodies
 * (magic-link URLs, business names, inviter names). The escapeHtml function
 * is the only line of defence against stored XSS in email clients that render
 * HTML. If escapeHtml misses a single character, a malicious business name
 * like `<script>...</script>` could execute in the recipient's email client.
 *
 * The function is not exported, so it is extracted verbatim here per the
 * same pattern used in shipment.test.ts and invoice-pdf-helpers.test.ts.
 *
 * SOURCE REFERENCE:
 *   packages/api/src/lib/email.ts  lines 5-12  escapeHtml
 */

import { describe, it, expect } from "vitest";

// =============================================================================
// Pure function — extracted verbatim from email.ts lines 5-12
// =============================================================================

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// =============================================================================
// Section 1: escapeHtml — XSS prevention in email HTML bodies
//
// The five HTML special characters each have a distinct attack vector:
//   &  — entity injection (e.g. &lt; inserted to produce further escapes)
//   <  — tag injection  (<script>, <img onerror=...>, etc.)
//   >  — closing-tag injection to escape existing tags
//   "  — attribute value breakout (href="...", onclick="...")
//   '  — attribute value breakout in single-quoted contexts
//
// All five must be escaped. Missing even one can be exploited.
// =============================================================================

describe("escapeHtml — escapes all five HTML special characters to prevent email XSS", () => {
  /**
   * escapeHtml is applied to every piece of user-controlled data before it
   * is interpolated into an email HTML template:
   *   - magic link URL   → href attribute + copy-link paragraph
   *   - deep link URL    → href attribute
   *   - inviter name     → paragraph text
   *   - business name    → paragraph text + strong element
   *   - invite URL       → href attribute + copy-link paragraph
   *
   * Email clients that render HTML (Gmail, Outlook web, Apple Mail) would
   * execute injected JavaScript if these characters were left unescaped.
   */

  // ── Individual character escaping ────────────────────────────────────────

  it("escapes '&' to '&amp;' — prevents entity injection", () => {
    /**
     * Unescaped '&' could be used to inject HTML entities.
     * Example: a business named "Sharma & Sons" must not produce literal &
     * in the HTML body, which could confuse the parser or be used to inject
     * further entities.
     */
    expect(escapeHtml("&")).toBe("&amp;");
  });

  it("escapes '<' to '&lt;' — prevents tag opening", () => {
    /**
     * The '<' character opens HTML tags. An unescaped '<' in a business
     * name like "<Gupta Traders>" would let an attacker inject arbitrary
     * HTML elements including script tags.
     */
    expect(escapeHtml("<")).toBe("&lt;");
  });

  it("escapes '>' to '&gt;' — prevents tag closing / tag injection", () => {
    /**
     * '>' can be used to close an existing attribute or tag and inject
     * content outside of it. An unescaped '>' in a URL could break the
     * surrounding anchor tag's href attribute.
     */
    expect(escapeHtml(">")).toBe("&gt;");
  });

  it("escapes '\"' to '&quot;' — prevents attribute value breakout in double-quoted contexts", () => {
    /**
     * The email templates use double-quoted HTML attributes:
     *   href="${escapeHtml(magicLinkUrl)}"
     * An unescaped '"' in the URL would terminate the attribute value and
     * allow injecting arbitrary attributes (e.g. onclick=...).
     */
    expect(escapeHtml('"')).toBe("&quot;");
  });

  it("escapes \"'\" to '&#039;' — prevents attribute value breakout in single-quoted contexts", () => {
    /**
     * Single-quoted attribute contexts also appear in some email client
     * rendering paths. The numeric entity &#039; is the safe choice here
     * as it is universally supported.
     */
    expect(escapeHtml("'")).toBe("&#039;");
  });

  // ── Multi-character / real-world inputs ─────────────────────────────────

  it("escapes a combined XSS attempt: <script>alert('xss')</script>", () => {
    /**
     * This is the canonical XSS test vector. If any single character escape
     * is missing, this string could inject a script tag into the email body.
     */
    const input = "<script>alert('xss')</script>";
    const output = escapeHtml(input);

    // The output must not contain any unescaped dangerous characters
    expect(output).not.toContain("<script>");
    expect(output).not.toContain("</script>");
    expect(output).not.toContain("'");
    expect(output).not.toContain('"');

    // Verify all five replacements are applied correctly
    expect(output).toContain("&lt;script&gt;");
    expect(output).toContain("&lt;/script&gt;");
    expect(output).toContain("&#039;xss&#039;");
  });

  it("escapes an attribute injection attempt: \" onclick=\"alert(1)\"", () => {
    /**
     * A malicious magic link URL containing a double-quote would break out
     * of the href attribute and inject arbitrary attributes like onclick.
     * Example unescaped: href="https://evil.com" onclick="alert(1)"
     */
    const input = 'https://evil.com" onclick="alert(1)';
    const output = escapeHtml(input);
    expect(output).not.toContain('"');
    expect(output).toContain("&quot;");
    expect(output).toContain("https://evil.com&quot; onclick=&quot;alert(1)");
  });

  it("escapes an HTML entity injection attempt: &lt;script&gt;", () => {
    /**
     * Double-escape attack: the attacker encodes < as &lt; hoping the
     * renderer decodes it. The escapeHtml function must also escape the
     * '&' in &lt;, producing &amp;lt; — safe to render as literal text.
     */
    const input = "&lt;script&gt;";
    const output = escapeHtml(input);
    expect(output).toBe("&amp;lt;script&amp;gt;");
  });

  it("escapes a realistic malicious business name containing multiple special chars", () => {
    /**
     * An attacker could register a business with a crafted name that
     * includes both tag characters and attribute-breaking quotes:
     *   Sharma & Sons <img src=x onerror="alert('pwned')">
     */
    const input = `Sharma & Sons <img src=x onerror="alert('pwned')">`;
    const output = escapeHtml(input);

    expect(output).not.toContain("<");
    expect(output).not.toContain(">");
    expect(output).not.toContain('"');
    expect(output).not.toContain("'");
    expect(output).toContain("&amp;");
    expect(output).toContain("&lt;");
    expect(output).toContain("&gt;");
    expect(output).toContain("&quot;");
    expect(output).toContain("&#039;");
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  it("returns an empty string unchanged", () => {
    /**
     * Empty strings are a valid input (optional inviter names can be null
     * and are coerced to "" before escaping in some callers).
     */
    expect(escapeHtml("")).toBe("");
  });

  it("returns normal text without special characters unchanged", () => {
    /**
     * The most common input — a real business name with no HTML chars.
     * The function must not alter safe text (e.g. no unnecessary escaping
     * of alphanumerics, spaces, or common punctuation like commas/periods).
     */
    expect(escapeHtml("Gupta Textiles Pvt Ltd")).toBe("Gupta Textiles Pvt Ltd");
    expect(escapeHtml("invoice@sharma.in")).toBe("invoice@sharma.in");
    expect(escapeHtml("Mumbai, Maharashtra")).toBe("Mumbai, Maharashtra");
  });

  it("handles an Indian business name with ampersand (common in firm names)", () => {
    /**
     * "& Co.", "& Sons", "& Brothers" appear frequently in Indian business
     * names registered under the Partnership Act. These names flow through
     * escapeHtml before appearing in invitation email subjects and bodies.
     */
    expect(escapeHtml("Patel & Brothers")).toBe("Patel &amp; Brothers");
    expect(escapeHtml("Ram & Co.")).toBe("Ram &amp; Co.");
  });

  it("escapes multiple '&' characters in a single string independently", () => {
    /**
     * A string like "A&B&C" has two ampersands, both must be replaced.
     * String.replace with a regex without the global flag would only
     * replace the first occurrence — the function uses regex literals
     * which replace all occurrences.
     */
    const result = escapeHtml("A&B&C");
    expect(result).toBe("A&amp;B&amp;C");
  });

  it("handles a URL with a query string containing special characters", () => {
    /**
     * Magic link URLs often contain query parameters with encoded special
     * characters. The '&' joining query params is particularly relevant.
     * Example: ?token=abc&redirect=/dashboard
     */
    const url = "https://app.hisaabo.in/auth/verify?token=abc123&redirect=/dashboard";
    const result = escapeHtml(url);
    expect(result).toContain("&amp;");
    expect(result).not.toContain('"');
    // The rest of the URL must be preserved verbatim
    expect(result).toContain("https://app.hisaabo.in/auth/verify?token=abc123");
    expect(result).toContain("redirect=/dashboard");
  });
});
