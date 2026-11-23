/**
 * RSA PKCS#1 v1.5 decryption for tests.
 *
 * Node refuses RSA_PKCS1_PADDING for private decryption (it is vulnerable to
 * Bleichenbacher/Marvin attacks), but it still encrypts with it, and the NIC IRP
 * expects exactly that padding. To prove what the client sent, decrypt with no
 * padding and strip the PKCS#1 v1.5 block (00 02 <non-zero random> 00 <message>) by hand.
 */
import { privateDecrypt, constants, type KeyObject } from "node:crypto";

export function pkcs1Decrypt(privateKey: KeyObject, ciphertext: Buffer): Buffer {
  const block = privateDecrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, ciphertext);
  if (block[0] !== 0x00 || block[1] !== 0x02) throw new Error("not a PKCS#1 v1.5 encryption block");
  const end = block.indexOf(0x00, 2);
  if (end < 10) throw new Error("malformed PKCS#1 v1.5 padding");
  return block.subarray(end + 1);
}
