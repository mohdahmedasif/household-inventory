import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Secrets saved from the Settings page are encrypted with AES-256-GCM before
// they reach the database. The encryption key is never stored in the database:
// it is a secret.key file created next to the database on first use. Without
// that file the stored values cannot be read.

const KEY_FILE = "secret.key";

function masterKey(dataDir) {
  const file = path.join(dataDir, KEY_FILE);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, crypto.randomBytes(32).toString("base64"), { mode: 0o600 });
  }
  return Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64");
}

export function encryptSecret(dataDir, plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(dataDir), iv);
  const body = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString("base64")).join(".");
}

/** The original value, or null when it cannot be decrypted with the current key. */
export function decryptSecret(dataDir, stored) {
  try {
    const [iv, tag, body] = String(stored).split(".").map((part) => Buffer.from(part, "base64"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(dataDir), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
