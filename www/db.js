// IndexedDB wrapper. All progress lives on the device.
// Stores: "cards" (SRS cards, indexed by due and deck) and "meta" (key/value settings).

const DB_NAME = "arabic-learner";
const DB_VERSION = 1;

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("cards")) {
        const cards = db.createObjectStore("cards", { keyPath: "id" });
        cards.createIndex("due", "due");
        cards.createIndex("deck", "deck");
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // If another context upgrades the schema, release our connection and reopen next time.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null; // allow a retry after failure
      reject(req.error ?? new Error("Could not open database"));
    };
    req.onblocked = () => {
      dbPromise = null;
      reject(new Error("Database upgrade blocked by another open tab"));
    };
  });
  return dbPromise;
}

/** Run `fn(store)` inside one transaction; resolves with fn's request result once the tx commits. */
async function withStore(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try {
      const req = fn(store);
      if (req) req.onsuccess = () => (result = req.result);
    } catch (err) {
      tx.abort();
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
}

// ---- cards ----

export const putCard = (card) => withStore("cards", "readwrite", (s) => s.put(card));

export const getCard = (id) => withStore("cards", "readonly", (s) => s.get(id));

export const getAllCards = () => withStore("cards", "readonly", (s) => s.getAll());

export const deleteCard = (id) => withStore("cards", "readwrite", (s) => s.delete(id));

/** Write many cards atomically: either all are saved or none are. */
export async function putCards(cards) {
  if (cards.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("cards", "readwrite");
    const store = tx.objectStore("cards");
    try {
      for (const card of cards) store.put(card);
    } catch (err) {
      tx.abort();
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
}

/**
 * Create cards that do not exist yet; cards that already exist are left untouched, so a
 * learner's progress is never overwritten. One atomic transaction.
 * Resolves with how many cards were actually added.
 */
export async function addCardsIfMissing(cards) {
  if (cards.length === 0) return 0;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("cards", "readwrite");
    const store = tx.objectStore("cards");
    let added = 0;
    try {
      for (const card of cards) {
        const req = store.add(card);
        req.onsuccess = () => {
          added++;
        };
        // "Already exists" is expected here: swallow it so the transaction keeps going.
        req.onerror = (event) => {
          event.preventDefault();
          event.stopPropagation();
        };
      }
    } catch (err) {
      tx.abort();
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(added);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
}

// ---- meta (settings, progress flags) ----

export async function getMeta(key, fallback = null) {
  const row = await withStore("meta", "readonly", (s) => s.get(key));
  return row ? row.value : fallback;
}

export const setMeta = (key, value) =>
  withStore("meta", "readwrite", (s) => s.put({ key, value }));
