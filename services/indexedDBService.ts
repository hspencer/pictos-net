/**
 * IndexedDB Service for storing large binary data (bitmaps)
 * LocalStorage has a ~5-10MB limit, IndexedDB can store 50MB-1GB+
 */

const DB_NAME = 'pictonet_storage';
const DB_VERSION = 1;
const STORE_NAME = 'bitmaps';

interface BitmapEntry {
  id: string;
  bitmap: string; // base64 data URL
  timestamp: number;
}

let dbInstance: IDBDatabase | null = null;

/**
 * Initialize IndexedDB
 */
export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('IndexedDB error:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create object store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        objectStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
};

/**
 * Save a bitmap to IndexedDB
 */
export const saveBitmap = async (id: string, bitmap: string): Promise<void> => {
  const db = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const entry: BitmapEntry = {
      id,
      bitmap,
      timestamp: Date.now()
    };

    const request = store.put(entry);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

/**
 * Get a bitmap from IndexedDB
 */
export const getBitmap = async (id: string): Promise<string | null> => {
  const db = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      const result = request.result as BitmapEntry | undefined;
      resolve(result?.bitmap || null);
    };

    request.onerror = () => reject(request.error);
  });
};

/**
 * Get all bitmaps from IndexedDB
 */
export const getAllBitmaps = async (): Promise<Map<string, string>> => {
  const db = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const entries = request.result as BitmapEntry[];
      const map = new Map<string, string>();
      entries.forEach(entry => {
        map.set(entry.id, entry.bitmap);
      });
      resolve(map);
    };

    request.onerror = () => reject(request.error);
  });
};

/**
 * Delete a bitmap from IndexedDB
 */
export const deleteBitmap = async (id: string): Promise<void> => {
  const db = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

/**
 * Delete all bitmaps from IndexedDB
 */
export const clearAllBitmaps = async (): Promise<void> => {
  const db = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

/**
 * Get database storage estimate
 */
export const getStorageEstimate = async (): Promise<{ usage: number; quota: number } | null> => {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const estimate = await navigator.storage.estimate();
    return {
      usage: estimate.usage || 0,
      quota: estimate.quota || 0
    };
  }
  return null;
};
