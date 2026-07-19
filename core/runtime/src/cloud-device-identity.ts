import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { writeJsonAtomic } from "./config.ts";

export function ensureCloudDeviceIdentity({ dataRoot, create = true } = {}) {
  const filePath = path.join(String(dataRoot || ""), "secrets", "applications", "cloud-node-device-key.json");
  if (fs.existsSync(filePath)) return readIdentity(filePath);
  if (!create) throw deviceIdentityError("CLOUD_SILENT_DEVICE_KEY_MISSING", "Cloud device proof key is unavailable");
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  writeJsonAtomic(filePath, {
    schemaVersion: 1,
    algorithm: "Ed25519",
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
    privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    createdAt: new Date().toISOString(),
  }, 0o600);
  return readIdentity(filePath);
}

export function signCloudDeviceProof(identity, message) {
  const key = crypto.createPrivateKey({ key: Buffer.from(identity.privateKey, "base64url"), format: "der", type: "pkcs8" });
  return crypto.sign(null, Buffer.from(String(message)), key).toString("base64url");
}

function readIdentity(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (value.schemaVersion !== 1 || value.algorithm !== "Ed25519" || !/^[A-Za-z0-9_-]{40,256}$/.test(value.publicKey)
      || !/^[A-Za-z0-9_-]{40,256}$/.test(value.privateKey)) throw new Error("invalid identity");
    const publicKey = crypto.createPublicKey({ key: Buffer.from(value.publicKey, "base64url"), format: "der", type: "spki" });
    const privateKey = crypto.createPrivateKey({ key: Buffer.from(value.privateKey, "base64url"), format: "der", type: "pkcs8" });
    if (publicKey.asymmetricKeyType !== "ed25519" || privateKey.asymmetricKeyType !== "ed25519") throw new Error("invalid identity");
    return { filePath, verificationKey: value.publicKey, privateKey: value.privateKey };
  } catch {
    throw deviceIdentityError("CLOUD_SILENT_DEVICE_KEY_INVALID", "Cloud device proof key is invalid");
  }
}

function deviceIdentityError(code, message) {
  return Object.assign(new Error(message), { code });
}
