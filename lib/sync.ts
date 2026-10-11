import type { BackupFile } from "./local-db";

export type EncryptedSyncPayload = { version: 1; iv: string; data: string; updatedAt: string };

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function createSyncCode() {
  return `BD1-${bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

export function normalizeSyncCode(value: string) {
  const normalized = value.trim().replace(/\s+/g, "");
  if (!/^BD1-[A-Za-z0-9_-]{43}$/.test(normalized)) throw new Error("Der Sync-Code ist ungültig.");
  return normalized;
}

async function keyAndId(code: string) {
  const secret = base64UrlToBytes(normalizeSyncCode(code).slice(4));
  const digest = await crypto.subtle.digest("SHA-256", secret);
  const id = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const key = await crypto.subtle.importKey("raw", secret, "AES-GCM", false, ["encrypt", "decrypt"]);
  return { id, key };
}

export async function encryptBackup(code: string, backup: BackupFile): Promise<{ id: string; payload: EncryptedSyncPayload }> {
  const { id, key } = await keyAndId(code);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(backup));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  return { id, payload: { version: 1, iv: bytesToBase64Url(iv), data: bytesToBase64Url(new Uint8Array(encrypted)), updatedAt: new Date().toISOString() } };
}

export async function decryptBackup(code: string, payload: EncryptedSyncPayload): Promise<BackupFile> {
  if (payload.version !== 1 || !payload.iv || !payload.data) throw new Error("Die Sync-Datei ist ungültig.");
  const { key } = await keyAndId(code);
  try {
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64UrlToBytes(payload.iv) }, key, base64UrlToBytes(payload.data));
    return JSON.parse(new TextDecoder().decode(decrypted)) as BackupFile;
  } catch {
    throw new Error("Sync-Code passt nicht zu den gespeicherten Daten.");
  }
}

export async function syncEndpointId(code: string) {
  return (await keyAndId(code)).id;
}
