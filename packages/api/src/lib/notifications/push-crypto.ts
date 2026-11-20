/**
 * End-to-end encryption of push payloads (docs/architecture/notifications.md §8.4).
 *
 * Implements RFC 8291 (Message Encryption for Web Push) with the RFC 8188
 * "aes128gcm" content coding. The same code path serves FCM/APNs (via Gorush),
 * browser Web Push and UnifiedPush, so Apple, Google and our own push
 * infrastructure only ever see ciphertext.
 *
 * The device generates a P-256 key pair and a 16-byte auth secret at
 * registration time and keeps the private key in its secure store; the server
 * only holds the public key and auth secret.
 */

import { createCipheriv, createDecipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";

const RECORD_SIZE = 4096;
const KEY_INFO_PREFIX = Buffer.from("WebPush: info\0", "utf8");
const CEK_INFO = Buffer.from("Content-Encoding: aes128gcm\0", "utf8");
const NONCE_INFO = Buffer.from("Content-Encoding: nonce\0", "utf8");

export function b64urlDecode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export function b64urlEncode(value: Buffer): string {
  return value.toString("base64url");
}

/** Validate a device's public key (65-byte uncompressed P-256 point) and auth secret (16 bytes). */
export function isValidDeviceKeys(publicKey: string, authSecret: string): boolean {
  try {
    const pub = b64urlDecode(publicKey);
    const auth = b64urlDecode(authSecret);
    if (pub.length !== 65 || pub[0] !== 0x04 || auth.length !== 16) return false;
    // computeSecret throws on a point that is not on the curve
    const probe = createECDH("prime256v1");
    probe.generateKeys();
    probe.computeSecret(pub);
    return true;
  } catch {
    return false;
  }
}

function hkdf(ikm: Buffer, salt: Buffer, info: Buffer, length: number): Buffer {
  return Buffer.from(hkdfSync("sha256", ikm, salt, info, length));
}

export interface EncryptOptions {
  /** Test hook: fixed 16-byte salt (RFC 8291 Appendix A). */
  salt?: Buffer;
  /** Test hook: fixed application-server private key. */
  serverPrivateKey?: Buffer;
}

/**
 * Encrypt `plaintext` for a device. Returns the RFC 8188 body:
 * salt(16) ‖ rs(4) ‖ idlen(1) ‖ keyid(65 = server public key) ‖ ciphertext.
 */
export function encryptForDevice(
  plaintext: Buffer | string,
  devicePublicKey: string,
  deviceAuthSecret: string,
  opts: EncryptOptions = {},
): Buffer {
  const uaPublic = b64urlDecode(devicePublicKey);
  const authSecret = b64urlDecode(deviceAuthSecret);
  const data = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;
  // One record only: payload + 1 delimiter byte + 16 byte tag must fit.
  if (data.length + 17 > RECORD_SIZE) throw new Error("Push payload too large");

  const server = createECDH("prime256v1");
  if (opts.serverPrivateKey) server.setPrivateKey(opts.serverPrivateKey);
  else server.generateKeys();
  const asPublic = server.getPublicKey();
  const ecdhSecret = server.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([KEY_INFO_PREFIX, uaPublic, asPublic]);
  const ikm = hkdf(ecdhSecret, authSecret, keyInfo, 32);

  const salt = opts.salt ?? randomBytes(16);
  const cek = hkdf(ikm, salt, CEK_INFO, 16);
  const nonce = hkdf(ikm, salt, NONCE_INFO, 12);

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // 0x02 = padding delimiter for the last (and only) record
  const ciphertext = Buffer.concat([cipher.update(Buffer.concat([data, Buffer.from([0x02])])), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, ciphertext]);
}

/**
 * Decrypt an RFC 8188 body with the device's private key. The production
 * decryptor lives on the device (iOS Notification Service Extension, Android
 * messaging service); this one exists for tests and tooling.
 */
export function decryptOnDevice(
  body: Buffer,
  devicePrivateKey: Buffer,
  deviceAuthSecret: string,
): Buffer {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);

  const device = createECDH("prime256v1");
  device.setPrivateKey(devicePrivateKey);
  const uaPublic = device.getPublicKey();
  const ecdhSecret = device.computeSecret(asPublic);
  const authSecret = b64urlDecode(deviceAuthSecret);

  const ikm = hkdf(ecdhSecret, authSecret, Buffer.concat([KEY_INFO_PREFIX, uaPublic, asPublic]), 32);
  const cek = hkdf(ikm, salt, CEK_INFO, 16);
  const nonce = hkdf(ikm, salt, NONCE_INFO, 12);

  const tag = ciphertext.subarray(ciphertext.length - 16);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(tag);
  const record = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  // Strip padding: trailing zeros, then the 0x02 delimiter
  let end = record.length - 1;
  while (end >= 0 && record[end] === 0) end--;
  if (end < 0 || record[end] !== 0x02) throw new Error("Invalid padding");
  return record.subarray(0, end);
}
