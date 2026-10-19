/**
 * This browser's push device, kept where both the page and the service worker can read it
 * (IndexedDB `mycity-push`, one record): the subscription's id on the server, the device
 * token the server gave it (Mark Read and renewal, with no session), and the VAPID public
 * key it subscribed with, so the service worker can subscribe again on its own
 * (docs/guides/notifications.md §3). Storage can be refused (a private window): every call
 * then answers null or does nothing, and the next sign-in saves the device again.
 */
export interface PushDeviceRecord {
  /** push_subscription_id */
  id: string;
  /** The device token, issued once by the server. */
  token: string;
  /** The VAPID public key (base64url) the subscription was made with. */
  key: string;
  /** Its short id (PushConfig.key_id). */
  keyId: string;
}

const DB = "mycity-push";
const STORE = "device";
const KEY = "this";

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = work(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(req.result ?? null);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

/** The device saved in this browser, or null. */
export async function readDevice(): Promise<PushDeviceRecord | null> {
  const v = await run<PushDeviceRecord | undefined>("readonly", (s) => s.get(KEY) as IDBRequest<PushDeviceRecord | undefined>);
  return v && typeof v.id === "string" && typeof v.token === "string" ? v : null;
}

/** Keeps the device; a token the server did not resend keeps the one already held. */
export async function writeDevice(next: Omit<PushDeviceRecord, "token"> & { token: string | null }): Promise<void> {
  const before = await readDevice();
  const token = next.token ?? (before && before.id === next.id ? before.token : null);
  if (!token) return;
  await run("readwrite", (s) => s.put({ ...next, token }, KEY));
}

/** Forgets the device (push turned off here). */
export async function clearDevice(): Promise<void> {
  await run("readwrite", (s) => s.delete(KEY));
}
