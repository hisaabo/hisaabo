/**
 * irp-public-key.ts — the NIC e-invoice (IRP) public key, loaded from operator
 * configuration.
 *
 * WHY THIS FILE EXISTS:
 * Authenticating with the IRP means RSA-encrypting the credentials with NIC's
 * public key. NIC publishes a different key for the sandbox and for production,
 * and the operator has to download them from the NIC e-invoice portal after
 * logging in, so no key can be bundled in the source (the one that used to be
 * here was not a valid key, and e-invoicing never authenticated). The key comes
 * from the environment instead:
 *
 *   production:  IRP_PUBLIC_KEY_PEM   or  IRP_PUBLIC_KEY_PATH
 *   sandbox:     IRP_SANDBOX_PUBLIC_KEY_PEM  or  IRP_SANDBOX_PUBLIC_KEY_PATH
 *
 * `*_PEM` holds the PEM text itself (newlines may be written as a literal `\n`,
 * which is how a multi-line value fits in a .env file); `*_PATH` points to a PEM
 * file. If both are set, `*_PEM` wins. The sandbox key is never used for
 * production or the other way round: a wrong key only shows up as an
 * authentication failure, which is much harder to diagnose than "not configured".
 *
 * The key is parsed once and cached. A missing or invalid key raises
 * IRPNotConfiguredError, with a message that says what to set, never an opaque
 * crypto error.
 */

import { createPublicKey, type KeyObject } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

export class IRPNotConfiguredError extends Error {
  readonly code = "IRP_NOT_CONFIGURED";

  constructor(detail: string) {
    super(
      `E-invoicing is not configured: the NIC public key is missing or invalid (${detail}). ` +
        'See docs/DEPLOYMENT.md, section "E-invoicing (IRP)".',
    );
    this.name = "IRPNotConfiguredError";
  }
}

/** The environment variables that carry the key for the sandbox or for production. */
export function irpPublicKeyEnvNames(isSandbox: boolean): { pem: string; path: string } {
  return isSandbox
    ? { pem: "IRP_SANDBOX_PUBLIC_KEY_PEM", path: "IRP_SANDBOX_PUBLIC_KEY_PATH" }
    : { pem: "IRP_PUBLIC_KEY_PEM", path: "IRP_PUBLIC_KEY_PATH" };
}

type Env = Record<string, string | undefined>;

const cache = new Map<string, { signature: string; key: KeyObject }>();

function parse(pemText: string, source: string): KeyObject {
  // A .env value cannot hold real newlines: accept the literal two characters \n too.
  const pem = pemText.trim().replace(/\\n/g, "\n");
  let key: KeyObject;
  try {
    // Accepts a PEM public key (SPKI or PKCS#1) and a PEM X.509 certificate, which is
    // how a public key is sometimes distributed.
    key = createPublicKey(pem);
  } catch {
    throw new IRPNotConfiguredError(`${source} is set but is not a valid PEM public key or certificate`);
  }
  if (key.asymmetricKeyType !== "rsa") {
    throw new IRPNotConfiguredError(`${source} is set but is not an RSA key`);
  }
  return key;
}

/**
 * The configured NIC public key for the sandbox or production, parsed and cached.
 * Throws IRPNotConfiguredError when it is missing, unreadable or invalid.
 */
export function loadIrpPublicKey(isSandbox: boolean, env: Env = process.env): KeyObject {
  const names = irpPublicKeyEnvNames(isSandbox);
  const pemValue = env[names.pem]?.trim();
  const pathValue = env[names.path]?.trim();

  if (pemValue) {
    const cached = cache.get(names.pem);
    if (cached?.signature === pemValue) return cached.key;
    const key = parse(pemValue, names.pem);
    cache.set(names.pem, { signature: pemValue, key });
    return key;
  }

  if (pathValue) {
    let text: string;
    let signature: string;
    try {
      signature = `${pathValue}:${statSync(pathValue).mtimeMs}`;
      const cached = cache.get(names.path);
      if (cached?.signature === signature) return cached.key;
      text = readFileSync(pathValue, "utf8");
    } catch (err) {
      const reason = (err as NodeJS.ErrnoException).code ?? "unreadable";
      throw new IRPNotConfiguredError(`${names.path} points to ${pathValue}, which cannot be read (${reason})`);
    }
    const key = parse(text, `${names.path} (${pathValue})`);
    cache.set(names.path, { signature, key });
    return key;
  }

  throw new IRPNotConfiguredError(`${names.pem} or ${names.path} is not set`);
}

/** For tests: forget every parsed key. */
export function resetIrpPublicKeyCache(): void {
  cache.clear();
}
